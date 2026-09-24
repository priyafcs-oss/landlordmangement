import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadBase64ToStorage } from "../_shared/storage.ts";
import { getAccessTokenForOwner, uploadBytesToDrive } from "../_shared/googleDrive.ts";
import { classifyDocument } from "./classify.ts";
import { parseInboundBill } from "./parse-bill.ts";
import { parseLeaseAgreement } from "./parse-lease.ts";
import { parseRentStatement } from "./parse-ledger.ts";
import { parsePropertyDocument } from "./parse-property-document.ts";
import { parseDepreciationReport } from "./parse-depreciation-report.ts";
import { stageUnclassifiedDocument } from "./parse-unclassified.ts";
import { parseLoanDocument } from "./parse-loan-document.ts";
import { parseLoanStatement } from "./parse-loan-statement.ts";
import { parseBankStatement } from "./parse-bank-statement.ts";
import { parsePropertySale } from "./parse-property-sale.ts";
import { stageAgencyAgreementProposal } from "./parse-agency-agreement.ts";
import type { NormalizedBillInput, ParseResult, ProposalParseResult } from "./types.ts";

/** Escapes ilike's wildcard characters (%, _) so a filename containing either can't accidentally
 * turn into a wildcard pattern — same guard as parse-bill.ts's own escapeIlike, kept local here
 * since this module has no other reason to import from there. */
function escapeIlike(s: string): string {
  return s.replace(/[%_]/g, (c) => `\\${c}`);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const raw = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Same resolution as ../_shared/storage.ts's resolveOwnerId, but also reports WHICH RPC scope to
 * fetch that owner's Drive refresh token with: "self" for an authenticated in-app call
 * (upload-document/reparse-document, whose Supabase client carries the calling landlord's own
 * session), "admin" for the service-role email webhook with no session, which falls back to
 * first_landlord_id() the same way every table's owner_id DEFAULT does.
 */
async function resolveOwnerAndScope(supabase: SupabaseClient): Promise<{ ownerId: string | null; scope: "self" | "admin" }> {
  const { data: userData } = await supabase.auth.getUser();
  if (userData?.user?.id) return { ownerId: userData.user.id, scope: "self" };
  const { data, error } = await supabase.rpc("first_landlord_id");
  if (error) {
    console.error("[parse-inbound-bill] failed to resolve fallback owner id", error);
    return { ownerId: null, scope: "admin" };
  }
  return { ownerId: (data as string | null) ?? null, scope: "admin" };
}

export type RouteResult = (ParseResult | ProposalParseResult) & {
  skipped?: boolean;
  documentType?: string;
  /** Set instead of processing when this exact filename was already seen — see the dedup check
   * at the top of routeInboundDocument. `existingProposalId`/`existingStatus` let the caller point
   * the landlord at the proposal already on file rather than silently making a second one. */
  duplicate?: boolean;
  existingProposalId?: string;
  existingStatus?: string;
};

/**
 * Classifies the inbound document, then dispatches to the type-specific extractor.
 * "other" with no attachment (a marketing email, a general enquiry) is a silent no-op — there's
 * nothing wrong with the email, there's just nothing to do. "other" WITH an attachment stages a
 * minimal unclassified proposal instead, so a forwarded/uploaded document this pipeline doesn't
 * have a dedicated parser for yet never just vanishes without a trace.
 */
export async function routeInboundDocument(
  supabase: SupabaseClient,
  input: NormalizedBillInput,
  emailMessageId: string | null,
): Promise<RouteResult> {
  // Move the attachment to the owning landlord's Drive (if connected) or the shared Storage
  // bucket (if not) once, up front, before any parser gets a chance to persist it inline — every
  // parser below writes `sourceFileData: input.pdfStoragePath`, never pdfBase64 directly
  // (pdfBase64 itself is still needed as-is for the Gemini calls just below/downstream). Which
  // owner this resolves to — and therefore which Drive gets written to — inherits the same known
  // limitation ../_shared/storage.ts's old resolveOwnerId always had for the email-webhook path
  // (no per-landlord email routing yet, see CLAUDE.md); this migration doesn't fix that, it just
  // makes owner resolution matter for one more thing.
  if (input.pdfBase64 && !input.pdfStoragePath) {
    const { ownerId, scope } = await resolveOwnerAndScope(supabase);
    const driveToken = await getAccessTokenForOwner(supabase, ownerId, scope);
    const pdfStoragePath = driveToken
      ? (await uploadBytesToDrive(driveToken.accessToken, driveToken.rootFolderId, base64ToUint8Array(input.pdfBase64), input.pdfFileName || "file", input.attachmentMimeType || "application/octet-stream")) ??
        (await uploadBase64ToStorage(supabase, input.pdfBase64, input.pdfFileName, ownerId, input.attachmentMimeType))
      : await uploadBase64ToStorage(supabase, input.pdfBase64, input.pdfFileName, ownerId, input.attachmentMimeType);
    input = { ...input, pdfStoragePath };
  }

  // The same physical statement/bill can arrive twice with no shared emailMessageId to catch it —
  // a manual re-upload (no message id at all) or the same document forwarded/re-sent as a genuinely
  // separate email. A byte-identical filename is a strong signal it's the same document (this
  // pipeline's own auto-named statements especially so, e.g. "OwnershipStatement45_...pdf"), so
  // check for one before spending a Gemini call and creating a second pending proposal for it.
  // Dismissed proposals count too — the landlord already made a call on that exact file once.
  if (input.pdfFileName) {
    const { data: existing } = await supabase
      .from("ai_intake_proposals")
      .select("id, status")
      .ilike("sourceFileName", escapeIlike(input.pdfFileName))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log(`[parse-inbound-bill] "${input.pdfFileName}" already on file as ${existing.id} (${existing.status}) — skipping`);
      return { ok: true, skipped: true, duplicate: true, existingProposalId: existing.id, existingStatus: existing.status };
    }
  }

  // "Upload statement to this loan" already asserts the document type — classifying it again
  // would just be redundant Gemini cost/latency and a source of misroute risk.
  if (input.loanIdHint) {
    return { ...(await parseLoanStatement(supabase, input, emailMessageId)), documentType: "loan_statement" };
  }
  if (input.bankAccountIdHint) {
    return { ...(await parseBankStatement(supabase, input, emailMessageId)), documentType: "bank_statement" };
  }

  // Best-effort — classification is still useful without it, so a lookup failure shouldn't
  // block the whole pipeline the way a genuine classification failure does below.
  const { data: entities } = await supabase.from("entities").select("name");
  const knownEntityNames = (entities ?? []).map((e) => e.name).filter(Boolean);

  let classification;
  try {
    classification = await classifyDocument(input, knownEntityNames);
  } catch (e) {
    // Unlike every downstream extractor, classification previously had no guard here — a
    // Gemini failure (bad/oversized attachment, quota, transient outage) propagated all the way
    // up as an unhandled exception, surfacing to the webhook caller as an opaque 500 instead of
    // a clear, retriable-looking 422 with the actual reason.
    const error = e instanceof Error ? e.message : "Document classification failed";
    console.error(`[parse-inbound-bill] classification failed for "${input.pdfFileName ?? "(no attachment)"}": ${error}`);
    return { ok: false, error: `Classification failed: ${error}` };
  }

  const documentType = classification.document_type;
  const tagged = async (result: Promise<ParseResult | ProposalParseResult>): Promise<RouteResult> => ({
    ...(await result),
    documentType,
  });

  switch (documentType) {
    case "bill":
      return tagged(parseInboundBill(supabase, input, emailMessageId));
    case "lease_agreement":
      return tagged(parseLeaseAgreement(supabase, input, emailMessageId));
    case "rent_statement":
      return tagged(parseRentStatement(supabase, input, emailMessageId));
    case "property_document":
      return tagged(parsePropertyDocument(supabase, input, emailMessageId));
    case "depreciation_report":
      return tagged(parseDepreciationReport(supabase, input, emailMessageId));
    case "loan_document":
      return tagged(parseLoanDocument(supabase, input, emailMessageId));
    case "loan_statement":
      return tagged(parseLoanStatement(supabase, input, emailMessageId));
    case "bank_statement":
      return tagged(parseBankStatement(supabase, input, emailMessageId));
    case "property_sale":
      return tagged(parsePropertySale(supabase, input, emailMessageId));
    case "agency_agreement":
      return tagged(stageAgencyAgreementProposal(supabase, input, emailMessageId));
    default:
      if (!input.pdfBase64) {
        console.log(`[parse-inbound-bill] classified as "other" (confidence ${classification.confidence}), no attachment, skipping`);
        return { ok: true, skipped: true, documentType };
      }
      console.log(`[parse-inbound-bill] classified as "other" (confidence ${classification.confidence}), staging as unclassified`);
      return tagged(stageUnclassifiedDocument(supabase, input, emailMessageId, classification.confidence));
  }
}
