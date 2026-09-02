import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { matchProvider } from "./provider-match.ts";
import {
  BILL_TYPES,
  type BillType,
  extractBillFields,
  mapAtoCategory,
  mapBillType,
  validateParsedBill,
} from "./core-parser.ts";
import type { NormalizedBillInput, ParsedBillFields, ParseResult, ProposalParseResult } from "./types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const DUPLICATE_WINDOW_DAYS = 14;
const PRICE_SPIKE_MULTIPLIER = 1.4;
const LOW_CONFIDENCE_THRESHOLD = 0.85;

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
): Promise<{ id: string } | null> {
  if (!matchedPropertyId) return null;
  const dueDate = new Date(parsed.due_date);
  const from = new Date(dueDate.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(dueDate.getTime() + DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("expenses")
    .select("id, cost, invoiceFileData, source")
    .eq("propertyId", matchedPropertyId)
    .ilike("itemName", parsed.vendor)
    .gte("date", from)
    .lte("date", to);
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
): Promise<{ clean: boolean; reviewReason: string | null }> {
  const reasons: string[] = [];

  const dueDate = new Date(parsed.due_date);
  const from = new Date(dueDate.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(dueDate.getTime() + DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

  const { data: dupeByVendor } = await supabase
    .from("expenses")
    .select("id")
    .ilike("itemName", parsed.vendor)
    .gte("date", from)
    .lte("date", to)
    .limit(1);

  let isDuplicate = (dupeByVendor?.length ?? 0) > 0;

  const amountTolerance = Math.max(2, parsed.amount * 0.02);

  // A bpayReference/CRN match alone is NOT sufficient on its own — most Australian utility
  // "reference numbers" are the ACCOUNT number, identical on every bill a provider ever sends, not
  // an invoice number. Without also requiring the amount or date to roughly agree, every new
  // period's genuine bill from a recurring biller (a water account's quarterly bill, say) got
  // flagged as a duplicate of whichever earlier bill happened to share that same account reference.
  if (!isDuplicate && parsed.bpay_reference) {
    const { data: dupeByRef } = await supabase.from("expenses").select("id, cost, date").eq("bpayReference", parsed.bpay_reference);
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
    const { data: dupeByVendorBill } = await supabase
      .from("property_bills")
      .select("id")
      .eq("status", "Unpaid")
      .ilike("providerName", parsed.vendor)
      .gte("dueDate", from)
      .lte("dueDate", to)
      .limit(1);
    isDuplicate = (dupeByVendorBill?.length ?? 0) > 0;
  }

  if (!isDuplicate && parsed.bpay_reference) {
    const { data: dupeByRefBill } = await supabase
      .from("property_bills")
      .select("id, amount, dueDate")
      .eq("status", "Unpaid")
      .eq("bpayReference", parsed.bpay_reference);
    isDuplicate = (dupeByRefBill ?? []).some(
      (b: { amount: number; dueDate: string }) =>
        Math.abs(Number(b.amount) - parsed.amount) <= amountTolerance ||
        Math.abs(new Date(b.dueDate).getTime() - dueDate.getTime()) <= DUPLICATE_WINDOW_DAYS * DAY_MS,
    );
  }

  if (isDuplicate) reasons.push("Possible Duplicate");

  const { data: history } = await supabase
    .from("expenses")
    .select("cost")
    .ilike("itemName", parsed.vendor);

  if (history && history.length > 0) {
    const avg = history.reduce((s: number, r: { cost: number }) => s + Number(r.cost), 0) / history.length;
    if (avg > 0 && parsed.amount > avg * PRICE_SPIKE_MULTIPLIER) {
      reasons.push("Price Spike Detected");
    }
  }

  if (parsed.confidence < LOW_CONFIDENCE_THRESHOLD || !matchedPropertyId) {
    reasons.push("Low Confidence / Unmatched Property");
  }

  // Water bills no longer force review on their own — a clean one auto-approves like any other
  // bill type. The recharge-to-tenant decision still needs surfacing, but as a non-blocking
  // Dashboard follow-up (writeApprovedBill's tenantRebillStatus) instead of a review gate.

  return {
    clean: reasons.length === 0,
    reviewReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

/**
 * Schedules the notice's future instalments (e.g. quarters 2-4 of a council rates notice) as
 * PropertyBill reminders — distinct from the Expense record, which only represents the instalment
 * that's due now. Dedupes against existing bills for the same property/type/due-date (±3 days) so
 * re-processing the same notice, or a later quarter's notice repeating the same schedule, doesn't
 * double-book.
 */
async function scheduleFutureInstalments(
  supabase: SupabaseClient,
  propertyId: string,
  billType: BillType,
  instalments: { due_date: string; amount: number }[],
  billGroupId: string,
  providerName: string,
  source: { fileName?: string; fileData?: string },
): Promise<number> {
  if (instalments.length === 0) return 0;

  const { data: existing } = await supabase
    .from("property_bills")
    .select("dueDate")
    .eq("propertyId", propertyId)
    .eq("billType", billType);
  const existingDates = (existing ?? []).map((r: { dueDate: string }) => new Date(r.dueDate).getTime());

  const rows = instalments
    .filter((i) => DATE_RE.test(i.due_date) && typeof i.amount === "number" && i.amount > 0)
    .filter((i) => {
      const t = new Date(i.due_date).getTime();
      return !existingDates.some((d) => Math.abs(d - t) <= 3 * DAY_MS);
    })
    .map((i, idx) => ({
      id: `bill_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      propertyId,
      billType,
      amount: i.amount,
      dueDate: i.due_date,
      status: "Unpaid" as const,
      notes: "Auto-scheduled from a future instalment on an emailed bill notice.",
      billGroupId,
      label: `Instalment ${idx + 2}`,
      providerName,
      source: "Email",
      sourceFileName: source.fileName,
      sourceFileData: source.fileData,
    }));

  if (rows.length === 0) return 0;
  const { error } = await supabase.from("property_bills").insert(rows);
  return error ? 0 : rows.length;
}

/** Council Rates bills come from the council itself; everything else defaults to a generic Trade/vendor contact. */
function mapProviderRole(billType: BillType): "Council" | "Trade" {
  return billType === "Council Rates" ? "Council" : "Trade";
}

/**
 * Saves (or updates) a provider/contact record from whatever contact details the notice printed,
 * so the landlord builds up a directory of councils/trades/insurers without typing them in by
 * hand. Deduped by property + name (case-insensitive) — a later bill from the same vendor fills in
 * any details this one didn't have, rather than creating a duplicate row each time.
 */
async function upsertProviderFromBill(
  supabase: SupabaseClient,
  propertyId: string,
  billType: BillType,
  parsed: ParsedBillFields,
): Promise<void> {
  const { data: existing } = await supabase
    .from("providers")
    .select("id, email, phone, website, abn, address")
    .eq("propertyId", propertyId)
    .ilike("name", parsed.vendor)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.email && parsed.vendor_email) patch.email = parsed.vendor_email;
    if (!existing.phone && parsed.vendor_phone) patch.phone = parsed.vendor_phone;
    if (!existing.website && parsed.vendor_website) patch.website = parsed.vendor_website;
    if (!existing.abn && parsed.vendor_abn) patch.abn = parsed.vendor_abn;
    if (!existing.address && parsed.vendor_address) patch.address = parsed.vendor_address;
    if (Object.keys(patch).length > 0) {
      await supabase.from("providers").update(patch).eq("id", existing.id);
    }
    return;
  }

  await supabase.from("providers").insert({
    id: `prov_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    propertyId,
    name: parsed.vendor,
    role: mapProviderRole(billType),
    email: parsed.vendor_email,
    phone: parsed.vendor_phone,
    website: parsed.vendor_website,
    abn: parsed.vendor_abn,
    address: parsed.vendor_address,
    notes: "Auto-saved from an emailed bill.",
  });
}

/** Which Property annual-running-cost column each bill type feeds, if any. */
const ANNUAL_COST_FIELD: Partial<Record<BillType, string>> = {
  "Council Rates": "councilRatesAnnual",
  Water: "waterRatesAnnual",
  Strata: "strataFeesAnnual",
  Insurance: "insuranceAnnual",
};

/**
 * Keeps the property's annual running-cost figures (used across P&L/forecast displays) current
 * automatically, instead of requiring manual entry every time a bill comes in. Deliberately
 * conservative about when it's confident enough to know the TRUE annual figure:
 *   - Insurance is normally billed as a single annual premium, so the bill's own amount IS the
 *     annual figure.
 *   - Council/Water/Strata are typically quarterly — only update when this notice's current
 *     instalment plus its 3 future instalments account for a full 4-quarter cycle. A single
 *     quarter alone isn't the annual total, and guessing would silently write a wrong number
 *     into the landlord's own figures.
 */
async function updateAnnualRunningCost(
  supabase: SupabaseClient,
  propertyId: string,
  billType: BillType,
  currentAmount: number,
  futureInstalments: { amount: number }[],
): Promise<void> {
  const field = ANNUAL_COST_FIELD[billType];
  if (!field) return;

  let annual: number | null = null;
  if (billType === "Insurance" && futureInstalments.length === 0) {
    annual = currentAmount;
  } else if (futureInstalments.length === 3) {
    annual = currentAmount + futureInstalments.reduce((s, i) => s + i.amount, 0);
  }
  if (annual === null) return;

  await supabase
    .from("properties")
    .update({ [field]: Math.round(annual * 100) / 100 })
    .eq("id", propertyId);
}

/** Clean-bill path — posts straight to property_bills (+ provider, annual cost, future
 * instalments) exactly as this pipeline always has for anything guardrails didn't flag. Unlike
 * before, this NEVER creates an Expense — bills only post to P&L once actually marked Paid
 * (markBillPaid, src/lib/store.tsx), regardless of how confidently they were read. */
async function writeApprovedBill(
  supabase: SupabaseClient,
  parsed: ParsedBillFields,
  matchedPropertyId: string | null,
  input: NormalizedBillInput,
  emailMessageId: string | null,
  matchedProviderId: string | undefined,
  defaultCategory: string | undefined,
): Promise<ParseResult> {
  const billId = `bill_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const billType = mapBillType(parsed.bill_category, parsed.vendor);
  const billGroupId = `bg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const source = { fileName: input.pdfFileName, fileData: input.pdfBase64 };

  const { error } = await supabase.from("property_bills").insert({
    id: billId,
    propertyId: matchedPropertyId,
    billType,
    amount: parsed.amount,
    dueDate: parsed.due_date,
    status: "Unpaid",
    providerName: parsed.vendor,
    providerId: matchedProviderId,
    category: defaultCategory,
    bpayBillerCode: parsed.bpay_biller_code ?? undefined,
    bpayReference: parsed.bpay_reference ?? undefined,
    source: "Email",
    billGroupId,
    label: parsed.future_instalments?.length ? "Instalment 1" : undefined,
    lineItems: parsed.line_items?.length ? parsed.line_items : [{ description: parsed.vendor, amount: parsed.amount }],
    sourceFileName: source.fileName,
    sourceFileData: source.fileData,
    taxCategory: mapAtoCategory(parsed.ato_category),
    emailMessageId,
    // Water auto-approves like any other clean bill now, but the recharge-to-tenant decision
    // still needs a non-blocking follow-up — surfaced on the Dashboard until resolved.
    tenantRebillStatus: billType === "Water" ? "pending" : undefined,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  let scheduledBillsCreated = 0;
  if (matchedPropertyId) {
    if (parsed.future_instalments?.length) {
      scheduledBillsCreated = await scheduleFutureInstalments(
        supabase,
        matchedPropertyId,
        billType,
        parsed.future_instalments,
        billGroupId,
        parsed.vendor,
        source,
      );
    }
    // Only create a new provider row when this vendor didn't already resolve to one via
    // matchProvider (portfolio-wide) — otherwise this would create a redundant property-scoped
    // duplicate of a provider that already exists (possibly portfolio-scoped, or on another
    // property). Creation itself stays gated to this auto-approved path either way.
    if (!matchedProviderId) {
      await upsertProviderFromBill(supabase, matchedPropertyId, billType, parsed);
    }
    await updateAnnualRunningCost(
      supabase,
      matchedPropertyId,
      billType,
      parsed.amount,
      parsed.future_instalments ?? [],
    );
  }

  return { ok: true, billId, status: "approved", reviewReason: null, matchedPropertyId, scheduledBillsCreated };
}

/** Flagged-bill path — stages a proposal for review instead of writing anything real yet. The
 * landlord's Approve action (client-side) does what writeApprovedBill does here, once they've
 * seen the line items and made any recharge-to-tenant decisions. */
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
      category: defaultCategory,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

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

  const attachable = await findAttachableExpense(supabase, parsed, matchedPropertyId);
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

  // Matching to an EXISTING provider is safe on both the approved and staged paths — only
  // CREATING a brand-new provider row (upsertProviderFromBill, below) stays gated to the
  // auto-approved path, so an unreviewed bill can't silently expand the directory.
  let defaultCategory: string | undefined;
  if (matchedProviderId) {
    const { data: providerRow } = await supabase
      .from("providers")
      .select("defaultCategory")
      .eq("id", matchedProviderId)
      .maybeSingle();
    defaultCategory = providerRow?.defaultCategory ?? undefined;
  }

  const { clean, reviewReason } = await runGuardrails(supabase, parsed, matchedPropertyId);

  return clean
    ? writeApprovedBill(supabase, parsed, matchedPropertyId, input, emailMessageId, matchedProviderId, defaultCategory)
    : stageBillProposal(
        supabase,
        parsed,
        matchedPropertyId,
        reviewReason,
        input,
        emailMessageId,
        matchedProviderId,
        defaultCategory,
      );
}
