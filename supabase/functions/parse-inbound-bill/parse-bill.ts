import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { matchProvider } from "./provider-match.ts";
import {
  extractBillFields,
  mapAtoCategory,
  mapBillType,
  mapExpenseCategory,
  validateParsedBill,
} from "./core-parser.ts";
import type { NormalizedBillInput, ParsedBillFields, ParseResult, ProposalParseResult } from "./types.ts";
import { isDuplicateEmailMessageId, findByEmailMessageId } from "./idempotency.ts";

const DAY_MS = 86_400_000;
const DUPLICATE_WINDOW_DAYS = 14;
const PRICE_SPIKE_MULTIPLIER = 1.4;
const LOW_CONFIDENCE_THRESHOLD = 0.85;

/** Escapes ilike's wildcard characters (%, _) so a free-text AI-extracted vendor name can't
 * accidentally turn into a wildcard pattern (e.g. "Pensioner Rebate 50% Applied" matching every
 * vendor whose name happens to start the same way as the text before the %). */
function escapeIlike(s: string): string {
  return s.replace(/[%_]/g, (c) => `\\${c}`);
}

/**
 * Looks for an existing Expense that this uploaded bill is actual evidence for, rather than a
 * separate new charge — the common case being a water/agent-fee deduction already posted from a
 * rent statement (vendor + amount + date) with the real bill PDF only forwarded or uploaded
 * afterwards. Same vendor + amount tolerance + date window as the client-side findDuplicateRecord
 * check (src/lib/billMatch.ts). Only attaches over a row that either has no invoice file yet, or
 * whose file is the whole rent statement it was posted from (source "email_auto") rather than a
 * dedicated per-vendor invoice — the real bill just uploaded is strictly more specific evidence
 * for that one charge, so it's worth attaching on top. A row that already carries its own
 * dedicated invoice is a genuine potential duplicate instead, left to runGuardrails below.
 */
async function findAttachableExpense(
  supabase: SupabaseClient,
  parsed: ParsedBillFields,
  matchedPropertyId: string | null,
  matchedProviderId: string | undefined,
): Promise<{ id: string } | null> {
  if (!matchedPropertyId) return null;
  const dueDate = new Date(parsed.due_date);
  const from = new Date(dueDate.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(dueDate.getTime() + DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

  // Matching by the resolved directory provider, when there is one, instead of an exact vendor
  // string is what lets this survive extraction wording drift (e.g. "Sydney Water" one time,
  // "Sydney Water (ABN 49 776 225 038)" the next) that would otherwise silently defeat an
  // itemName-equals-vendor comparison and post the same real bill twice.
  let query = supabase.from("expenses").select("id, cost, invoiceFileData, source").eq("propertyId", matchedPropertyId).gte("date", from).lte("date", to);
  query = matchedProviderId ? query.eq("providerId", matchedProviderId) : query.ilike("itemName", escapeIlike(parsed.vendor));
  const { data } = await query;
  if (!data || data.length === 0) return null;

  const tolerance = Math.max(2, parsed.amount * 0.02);
  const match = data.find(
    (e: { cost: number; invoiceFileData: string | null; source: string | null }) =>
      Math.abs(Number(e.cost) - parsed.amount) <= tolerance && (!e.invoiceFileData || e.source === "email_auto"),
  );
  return match ? { id: match.id } : null;
}

/**
 * Decides whether this bill can post straight to expenses (clean, confident, matched, no
 * duplicate/price-spike) or needs a human decision first. Water bills always need review
 * regardless of how clean everything else looks, since they almost always carry a
 * tenant-rechargeable usage component the landlord should see the line items for before it's
 * counted anywhere.
 */
async function runGuardrails(
  supabase: SupabaseClient,
  parsed: ParsedBillFields,
  matchedPropertyId: string | null,
  matchedProviderId: string | undefined,
): Promise<{ reviewReason: string | null }> {
  const reasons: string[] = [];

  const dueDate = new Date(parsed.due_date);
  const from = new Date(dueDate.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(dueDate.getTime() + DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

  // Scoped to the matched property when known — otherwise two properties sharing the same agent
  // or utility provider (a very common case) can each false-positive off the other's genuine,
  // unrelated charge just for landing in the same vendor+date window. Matched by providerId when
  // there is one rather than an exact vendor string, for the same wording-drift reason as
  // findAttachableExpense above.
  let dupeQuery = supabase.from("expenses").select("id").gte("date", from).lte("date", to);
  dupeQuery = matchedProviderId ? dupeQuery.eq("providerId", matchedProviderId) : dupeQuery.ilike("itemName", escapeIlike(parsed.vendor));
  if (matchedPropertyId) dupeQuery = dupeQuery.eq("propertyId", matchedPropertyId);
  const { data: dupeByVendor } = await dupeQuery.limit(1);

  let isDuplicate = (dupeByVendor?.length ?? 0) > 0;

  const amountTolerance = Math.max(2, parsed.amount * 0.02);

  // A bpayReference/CRN match alone is NOT sufficient on its own — most Australian utility
  // "reference numbers" are the ACCOUNT number, identical on every bill a provider ever sends, not
  // an invoice number. Without also requiring the amount or date to roughly agree, every new
  // period's genuine bill from a recurring biller (a water account's quarterly bill, say) got
  // flagged as a duplicate of whichever earlier bill happened to share that same account reference.
  if (!isDuplicate && parsed.bpay_reference) {
    let refQuery = supabase.from("expenses").select("id, cost, date").eq("bpayReference", parsed.bpay_reference);
    if (matchedPropertyId) refQuery = refQuery.eq("propertyId", matchedPropertyId);
    const { data: dupeByRef } = await refQuery;
    isDuplicate = (dupeByRef ?? []).some(
      (e: { cost: number; date: string }) =>
        Math.abs(Number(e.cost) - parsed.amount) <= amountTolerance ||
        Math.abs(new Date(e.date).getTime() - dueDate.getTime()) <= DUPLICATE_WINDOW_DAYS * DAY_MS,
    );
  }

  // Bills no longer get a paired Expense at intake, only at payment — so an already-staged or
  // already-scheduled Unpaid bill for the same vendor/window has to be checked here too, or a
  // second forward of the same notice would silently stop being caught as a duplicate.
  if (!isDuplicate) {
    let billQuery = supabase.from("property_bills").select("id").eq("status", "Unpaid").gte("dueDate", from).lte("dueDate", to);
    billQuery = matchedProviderId
      ? billQuery.eq("providerId", matchedProviderId)
      : billQuery.ilike("providerName", escapeIlike(parsed.vendor));
    if (matchedPropertyId) billQuery = billQuery.eq("propertyId", matchedPropertyId);
    const { data: dupeByVendorBill } = await billQuery.limit(1);
    isDuplicate = (dupeByVendorBill?.length ?? 0) > 0;
  }

  if (!isDuplicate && parsed.bpay_reference) {
    let refBillQuery = supabase
      .from("property_bills")
      .select("id, amount, dueDate")
      .eq("status", "Unpaid")
      .eq("bpayReference", parsed.bpay_reference);
    if (matchedPropertyId) refBillQuery = refBillQuery.eq("propertyId", matchedPropertyId);
    const { data: dupeByRefBill } = await refBillQuery;
    isDuplicate = (dupeByRefBill ?? []).some(
      (b: { amount: number; dueDate: string }) =>
        Math.abs(Number(b.amount) - parsed.amount) <= amountTolerance ||
        Math.abs(new Date(b.dueDate).getTime() - dueDate.getTime()) <= DUPLICATE_WINDOW_DAYS * DAY_MS,
    );
  }

  if (isDuplicate) reasons.push("Possible Duplicate");

  // Also property-scoped for the same reason as the duplicate checks above — otherwise a bigger
  // property's larger historical bills from the same vendor dilute/skew the average used here,
  // hiding a real spike on a smaller property and false-flagging a legitimately larger one.
  let historyQuery = supabase.from("expenses").select("cost");
  historyQuery = matchedProviderId
    ? historyQuery.eq("providerId", matchedProviderId)
    : historyQuery.ilike("itemName", escapeIlike(parsed.vendor));
  if (matchedPropertyId) historyQuery = historyQuery.eq("propertyId", matchedPropertyId);
  const { data: history } = await historyQuery;

  if (history && history.length > 0) {
    const avg = history.reduce((s: number, r: { cost: number }) => s + Number(r.cost), 0) / history.length;
    if (avg > 0 && parsed.amount > avg * PRICE_SPIKE_MULTIPLIER) {
      reasons.push("Price Spike Detected");
    }
  }

  if (parsed.confidence < LOW_CONFIDENCE_THRESHOLD || !matchedPropertyId) {
    reasons.push("Low Confidence / Unmatched Property");
  }

  return { reviewReason: reasons.length > 0 ? reasons.join("; ") : null };
}

/** Every bill stages for review before anything real is written — the landlord's Approve action
 * (client-side, AddBillDialog's commitSave) is what actually posts it, schedules any future
 * instalments, upserts the provider directory entry and updates the property's annual running
 * cost, once they've seen the line items and made any recharge-to-tenant decision. This pipeline
 * previously auto-posted a "clean" bill straight to property_bills with no human ever seeing it —
 * removed after a manually re-uploaded water bill went straight through with no chance to split
 * the usage charge to the tenant, and no visible sign it hadn't been reviewed. */
async function stageBillProposal(
  supabase: SupabaseClient,
  parsed: ParsedBillFields,
  matchedPropertyId: string | null,
  reviewReason: string | null,
  input: NormalizedBillInput,
  emailMessageId: string | null,
  matchedProviderId: string | undefined,
  defaultCategory: string | undefined,
): Promise<ProposalParseResult> {
  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "bill",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    documentDate: undefined,
    providerName: parsed.vendor,
    addressedTo: parsed.addressed_to ?? undefined,
    reviewReason,
    payload: {
      amount: parsed.amount,
      dueDate: parsed.due_date,
      bpayBillerCode: parsed.bpay_biller_code ?? undefined,
      bpayReference: parsed.bpay_reference ?? undefined,
      atoCategory: mapAtoCategory(parsed.ato_category),
      billCategory: mapBillType(parsed.bill_category, parsed.vendor),
      futureInstalments: parsed.future_instalments?.map((i) => ({ dueDate: i.due_date, amount: i.amount })),
      lineItems: parsed.line_items?.length ? parsed.line_items : [{ description: parsed.vendor, amount: parsed.amount }],
      vendorEmail: parsed.vendor_email ?? undefined,
      vendorPhone: parsed.vendor_phone ?? undefined,
      vendorWebsite: parsed.vendor_website ?? undefined,
      vendorAbn: parsed.vendor_abn ?? undefined,
      vendorAddress: parsed.vendor_address ?? undefined,
      providerId: matchedProviderId,
      category: defaultCategory ?? mapExpenseCategory(parsed.expense_category, parsed.vendor),
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) {
    if (emailMessageId && isDuplicateEmailMessageId(error)) {
      const existing = await findByEmailMessageId(supabase, "ai_intake_proposals", emailMessageId);
      if (existing) return { ok: true, proposalId: existing.id };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, proposalId: row.id };
}

export async function parseInboundBill(
  supabase: SupabaseClient,
  input: NormalizedBillInput,
  emailMessageId: string | null,
): Promise<ParseResult | ProposalParseResult> {
  if (emailMessageId) {
    const { data: existingBill } = await supabase
      .from("property_bills")
      .select("id")
      .eq("emailMessageId", emailMessageId)
      .maybeSingle();
    if (existingBill) return { ok: true, billId: existingBill.id };

    const { data: existingProposal } = await supabase
      .from("ai_intake_proposals")
      .select("id")
      .eq("emailMessageId", emailMessageId)
      .maybeSingle();
    if (existingProposal) return { ok: true, proposalId: existingProposal.id };
  }

  // Best-effort — extraction is still useful without it, so a lookup failure here shouldn't block
  // the whole pipeline. Fetching a lightweight list of known provider names/ABNs and folding them
  // into the extraction prompt lets Gemini normalize a vendor's spelling against what's already on
  // file (same pattern router.ts already uses for known entity names on classification).
  const { data: knownProviders } = await supabase.from("providers").select("name, abn");

  let parsed: ParsedBillFields;
  try {
    parsed = await extractBillFields(input, knownProviders ?? []);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  const validationError = validateParsedBill(parsed);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "", parsed.bpay_reference);
  const matchedProviderId = await matchProvider(supabase, parsed.vendor, parsed.vendor_abn);

  const attachable = await findAttachableExpense(supabase, parsed, matchedPropertyId, matchedProviderId);
  if (attachable) {
    const { error } = await supabase
      .from("expenses")
      .update({
        invoiceFileName: input.pdfFileName,
        invoiceFileData: input.pdfBase64,
        sourceSubject: input.subject,
        sourceEmailBody: input.textBody,
      })
      .eq("id", attachable.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, linkedExpenseId: attachable.id, status: "approved", reviewReason: null, matchedPropertyId };
  }

  let defaultCategory: string | undefined;
  if (matchedProviderId) {
    const { data: providerRow } = await supabase
      .from("providers")
      .select("defaultCategory")
      .eq("id", matchedProviderId)
      .maybeSingle();
    defaultCategory = providerRow?.defaultCategory ?? undefined;
  }

  // reviewReason is still computed (and shown as a badge on the review card) even though it no
  // longer decides whether to stage — every bill stages now, see stageBillProposal's doc comment.
  const { reviewReason } = await runGuardrails(supabase, parsed, matchedPropertyId, matchedProviderId);

  return stageBillProposal(supabase, parsed, matchedPropertyId, reviewReason, input, emailMessageId, matchedProviderId, defaultCategory);
}
