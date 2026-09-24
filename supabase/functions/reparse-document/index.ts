import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isStoragePath, resolveOwnerId, resolveStoredBase64, uploadBase64ToStorage } from "../_shared/storage.ts";
import { downloadBytesFromDrive, driveFileId, getAccessTokenForOwner, isGoogleDrivePath, uploadBytesToDrive } from "../_shared/googleDrive.ts";
import { parseInboundBill } from "../parse-inbound-bill/parse-bill.ts";
import { parseLeaseAgreement } from "../parse-inbound-bill/parse-lease.ts";
import { parseRentStatement } from "../parse-inbound-bill/parse-ledger.ts";
import { parsePropertyDocument } from "../parse-inbound-bill/parse-property-document.ts";
import { parseDepreciationReport } from "../parse-inbound-bill/parse-depreciation-report.ts";
import { parseLoanDocument } from "../parse-inbound-bill/parse-loan-document.ts";
import { parseLoanStatement } from "../parse-inbound-bill/parse-loan-statement.ts";
import { parseBankStatement } from "../parse-inbound-bill/parse-bank-statement.ts";
import { parsePropertySale } from "../parse-inbound-bill/parse-property-sale.ts";
import type { NormalizedBillInput, ParseResult, ProposalParseResult } from "../parse-inbound-bill/types.ts";

interface ReparseRequest {
  proposalId?: string;
  documentType?: string;
}

function inferMimeType(fileName?: string): string {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (["png", "gif", "webp", "heic"].includes(ext)) return `image/${ext}`;
  return "application/pdf";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const raw = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Lets a landlord tell the app "this unclassified upload is actually a lease / rent statement /
 * etc" and re-run extraction with that specific type's parser — reuses the exact same DB-writing
 * parsers the email/upload pipeline already dispatches to per DocumentType (see router.ts),
 * just chosen by the landlord instead of guessed by Gemini's classification step. On success the
 * original unclassified proposal row is deleted (only after the replacement is confirmed written,
 * so a failed re-parse never leaves neither the original nor a usable result).
 *
 * Uses a Supabase client scoped to the caller's own session token (verified below) rather than
 * the service-role key — see upload-document/index.ts's doc comment for why, and note it also
 * means the `ai_intake_proposals` lookup below can only ever find the calling landlord's own
 * proposals, not another landlord's.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: ReparseRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.proposalId || !body.documentType) {
    return new Response(JSON.stringify({ error: "proposalId and documentType are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: existing, error: loadError } = await supabase
    .from("ai_intake_proposals")
    .select("*")
    .eq("id", body.proposalId)
    .maybeSingle();
  if (loadError || !existing) {
    return new Response(JSON.stringify({ error: "Original document not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!existing.sourceFileData) {
    return new Response(JSON.stringify({ error: "No source file on this document to re-read" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ownerId = await resolveOwnerId(supabase);

  // sourceFileData is a "gdrive:<fileId>" marker (an owner who's connected Drive), a
  // "storage:<path>" marker (Supabase Storage — either not-yet-migrated to Drive, or the owner
  // hasn't connected Drive at all), or legacy inline base64 — resolve whichever it is back to real
  // bytes before handing it to Gemini, which needs actual base64, not a path.
  let pdfBase64: string | undefined;
  let pdfStoragePath: string | undefined = existing.sourceFileData;

  if (isGoogleDrivePath(existing.sourceFileData)) {
    const token = await getAccessTokenForOwner(supabase, ownerId, "self");
    const downloaded = token ? await downloadBytesFromDrive(token.accessToken, driveFileId(existing.sourceFileData)) : null;
    if (!downloaded) {
      return new Response(JSON.stringify({ error: "Couldn't read the stored source file from Google Drive" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    pdfBase64 = bytesToBase64(downloaded.bytes);
    // Re-parsing re-classifies the SAME document — reuse the same Drive file rather than
    // re-uploading these bytes a second time.
  } else {
    pdfBase64 = await resolveStoredBase64(supabase, existing.sourceFileData);
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: "Couldn't read the stored source file" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isStoragePath(existing.sourceFileData)) {
      // A not-yet-backfilled legacy row (still inline base64) gets uploaded here for the first
      // time — to the owner's Drive if they're connected, otherwise Supabase Storage as before,
      // so re-parsing an old row also migrates it onto whichever backend that owner is on.
      const token = await getAccessTokenForOwner(supabase, ownerId, "self");
      pdfStoragePath = token
        ? (await uploadBytesToDrive(token.accessToken, token.rootFolderId, base64ToUint8Array(pdfBase64), existing.sourceFileName ?? "file", inferMimeType(existing.sourceFileName))) ?? existing.sourceFileData
        : await uploadBase64ToStorage(supabase, pdfBase64, existing.sourceFileName ?? undefined, ownerId, inferMimeType(existing.sourceFileName));
    }
    // Already a "storage:<path>" marker — left unchanged here; migrating an already-Storage-backed
    // document to Drive is the batch migration script's job (../migrate-storage-to-drive), not a
    // side effect of an unrelated re-parse.
  }

  const input: NormalizedBillInput = {
    fromEmail: "manual-upload",
    subject: existing.sourceSubject || existing.sourceFileName || "Re-parsed document",
    pdfBase64,
    pdfStoragePath,
    pdfFileName: existing.sourceFileName ?? undefined,
    attachmentMimeType: inferMimeType(existing.sourceFileName),
    textBody: existing.sourceEmailBody ?? undefined,
  };

  let result: ParseResult | ProposalParseResult;
  try {
    switch (body.documentType) {
      case "bill":
        result = await parseInboundBill(supabase, input, null);
        break;
      case "lease_agreement":
        result = await parseLeaseAgreement(supabase, input, null);
        break;
      case "rent_statement":
        result = await parseRentStatement(supabase, input, null);
        break;
      case "property_document":
        result = await parsePropertyDocument(supabase, input, null);
        break;
      case "depreciation_report":
        result = await parseDepreciationReport(supabase, input, null);
        break;
      case "loan_document":
        result = await parseLoanDocument(supabase, input, null);
        break;
      case "loan_statement":
        result = await parseLoanStatement(supabase, input, null);
        break;
      case "bank_statement":
        result = await parseBankStatement(supabase, input, null);
        break;
      case "property_sale":
        result = await parsePropertySale(supabase, input, null);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unsupported document type: ${body.documentType}` }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (e) {
    console.error("[reparse-document] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Extraction failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error || "Couldn't extract this document as that type" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("ai_intake_proposals").delete().eq("id", body.proposalId);

  const r = result as { proposalId?: string; billId?: string };
  return new Response(JSON.stringify({ ok: true, proposalId: r.proposalId, billId: r.billId, documentType: body.documentType }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
