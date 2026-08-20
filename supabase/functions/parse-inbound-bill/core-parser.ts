import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedBillFields, ParseResult } from "./types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const DUPLICATE_WINDOW_DAYS = 14;
const PRICE_SPIKE_MULTIPLIER = 1.4;
const LOW_CONFIDENCE_THRESHOLD = 0.85;

const BILL_PROMPT = `You are extracting structured invoice data from an Australian property bill email (council rates, water, strata, or similar).
Extract the fields defined in the response schema as strict JSON.
- due_date must be formatted YYYY-MM-DD, and is the instalment that is CURRENTLY due / due soonest.
- bpay_biller_code and bpay_reference must be null if the bill has no BPAY details.
- bill_category must be one of: Water, Council Rates, Strata, Insurance, Electricity, Gas, Other.
- future_instalments is REQUIRED — you must always include this field, even as an empty array [] when
  there is no schedule to extract. Do not omit it under any circumstances.
- Many Australian council and water rate notices print the FULL year's payment schedule on one notice,
  typically as a table like:
    Instalment   Due Date      Amount
    1st Instalment   31 Aug 2026   $558.13
    2nd Instalment   30 Nov 2026   $557.90
    3rd Instalment   28 Feb 2027   $557.90
    4th Instalment   31 May 2027   $557.90
  — even though only the 1st instalment is currently payable (that one goes in due_date/amount, NOT
  repeated in future_instalments). Extract every OTHER row from a table like this — 2nd, 3rd, 4th
  instalment, or "Quarter 2/3/4", or any similarly-labelled future due date — into future_instalments,
  each with its own due_date (YYYY-MM-DD) and amount. Look specifically for a table or list with a
  heading resembling "Instalment / Due Date / Amount" — it is often on the same page as the total, near
  a "PAY BY INSTALMENTS" vs "PAY ENTIRE YEAR" style summary box. Only return [] if you have genuinely
  checked and no such table/schedule appears anywhere in the document.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is, based on how clearly each field was stated in the source. Use 1.0 only when every field was explicit and unambiguous; lower it when you had to infer or guess.
- vendor_email, vendor_phone, vendor_website, vendor_abn, vendor_address: the biller's own contact
  details, if printed anywhere on the notice (often in a "Contact us" or footer section) — null for
  any that aren't shown. Do not guess or invent these.
- line_items is REQUIRED — always include it, even as an empty array [] when the notice shows only
  one flat total. Many bills break the current instalment's total into distinct charges — e.g. a
  water bill printing "Water Access/Service Charge" and "Water Usage Charge" as separate lines, or a
  council notice splitting "General Rate", "Waste Levy" and "Environmental Levy". Extract EVERY such
  line as its own item with its own description and amount — do not collapse them into one. The
  amounts must sum to exactly the top-level "amount" field (the current instalment's total). If the
  notice genuinely shows only a single undifferentiated total with no breakdown, return one line item
  whose description is the vendor/bill type and whose amount equals the total.`;

const BILL_SCHEMA = {
  type: "OBJECT",
  properties: {
    vendor: { type: "STRING" },
    amount: { type: "NUMBER" },
    due_date: { type: "STRING" },
    property_address: { type: "STRING" },
    bpay_biller_code: { type: "STRING", nullable: true },
    bpay_reference: { type: "STRING", nullable: true },
    ato_category: { type: "STRING" },
    bill_category: { type: "STRING" },
    future_instalments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          due_date: { type: "STRING" },
          amount: { type: "NUMBER" },
        },
        required: ["due_date", "amount"],
      },
    },
    vendor_email: { type: "STRING", nullable: true },
    vendor_phone: { type: "STRING", nullable: true },
    vendor_website: { type: "STRING", nullable: true },
    vendor_abn: { type: "STRING", nullable: true },
    vendor_address: { type: "STRING", nullable: true },
    line_items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          amount: { type: "NUMBER" },
        },
        required: ["description", "amount"],
      },
    },
    confidence: { type: "NUMBER" },
  },
  required: [
    "vendor",
    "amount",
    "due_date",
    "property_address",
    "ato_category",
    "bill_category",
    "future_instalments",
    "line_items",
    "confidence",
  ],
};

/** Shared with extract-bill (the stateless upload-and-preview endpoint behind the Add Bill dialog). */
export async function extractBillFields(input: NormalizedBillInput): Promise<ParsedBillFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(BILL_PROMPT, input);
  return callGeminiJSON<ParsedBillFields>(apiKey, parts, BILL_SCHEMA);
}
const callGemini = extractBillFields;

function validateParsed(parsed: ParsedBillFields): string | null {
  if (!parsed.vendor || typeof parsed.vendor !== "string") return "Missing vendor";
  if (typeof parsed.amount !== "number" || !(parsed.amount > 0)) return "Missing or invalid amount";
  if (!DATE_RE.test(parsed.due_date ?? "")) return "Missing or invalid due_date";
  return null;
}

/** Maps Gemini's free-text ato_category onto the app's existing two-value tax category union. */
function mapAtoCategory(category: string): "Immediate Deduction" | "Capital Works" {
  const c = (category ?? "").toLowerCase();
  if (c.includes("capital") || c.includes("improvement") || c.includes("renovation")) {
    return "Capital Works";
  }
  return "Immediate Deduction";
}

const BILL_TYPES = ["Water", "Council Rates", "Strata", "Insurance", "Electricity", "Gas", "Other"] as const;
type BillType = (typeof BILL_TYPES)[number];

/** Maps Gemini's free-text bill_category (or the vendor name, as a fallback) onto the app's BillType union. */
function mapBillType(billCategory: string, vendor: string): BillType {
  const exact = BILL_TYPES.find((t) => t.toLowerCase() === (billCategory ?? "").trim().toLowerCase());
  if (exact) return exact;
  const haystack = `${billCategory ?? ""} ${vendor ?? ""}`.toLowerCase();
  if (haystack.includes("council") || haystack.includes("rates")) return "Council Rates";
  if (haystack.includes("water")) return "Water";
  if (haystack.includes("strata") || haystack.includes("owners corp")) return "Strata";
  if (haystack.includes("insur")) return "Insurance";
  if (haystack.includes("electric") || haystack.includes("power")) return "Electricity";
  if (haystack.includes("gas")) return "Gas";
  return "Other";
}

/**
 * Schedules the notice's future instalments (e.g. quarters 2-4 of a council rates notice) as
 * PropertyBill reminders — distinct from the Expense record, which only represents the instalment
 * that's due now. Skipped entirely if the property couldn't be matched, since PropertyBill requires
 * one. Dedupes against existing bills for the same property/type/due-date (±3 days) so re-processing
 * the same notice, or a later quarter's notice repeating the same schedule, doesn't double-book.
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
  const hasAnyContactInfo = parsed.vendor_email || parsed.vendor_phone || parsed.vendor_website || parsed.vendor_abn;
  if (!hasAnyContactInfo) return;

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

async function runGuardrails(
  supabase: SupabaseClient,
  parsed: ParsedBillFields,
  matchedPropertyId: string | null,
): Promise<{ status: "approved" | "needs_review"; reviewReason: string | null }> {
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

  if (!isDuplicate && parsed.bpay_reference) {
    const { data: dupeByRef } = await supabase
      .from("expenses")
      .select("id")
      .eq("bpayReference", parsed.bpay_reference)
      .limit(1);
    isDuplicate = (dupeByRef?.length ?? 0) > 0;
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

  return {
    status: reasons.length > 0 ? "needs_review" : "approved",
    reviewReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

export async function parseInboundBill(
  supabase: SupabaseClient,
  input: NormalizedBillInput,
  emailMessageId: string | null,
): Promise<ParseResult> {
  if (emailMessageId) {
    const { data: existing } = await supabase
      .from("expenses")
      .select("id")
      .eq("emailMessageId", emailMessageId)
      .maybeSingle();
    if (existing) {
      return { ok: true, expenseId: existing.id };
    }
  }

  let parsed: ParsedBillFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  const validationError = validateParsed(parsed);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "", parsed.bpay_reference);
  const { status, reviewReason } = await runGuardrails(supabase, parsed, matchedPropertyId);

  const row = {
    id: `ex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    itemName: parsed.vendor,
    cost: parsed.amount,
    date: parsed.due_date,
    propertyId: matchedPropertyId,
    taxCategory: mapAtoCategory(parsed.ato_category),
    hasWarranty: false,
    rechargeToTenant: false,
    status,
    source: "email_auto",
    bpayBillerCode: parsed.bpay_biller_code,
    bpayReference: parsed.bpay_reference,
    rawPropertyAddress: parsed.property_address,
    emailMessageId,
    reviewReason,
    invoiceFileName: input.pdfFileName,
    invoiceFileData: input.pdfBase64,
    sourceSubject: input.subject,
    sourceEmailBody: input.textBody,
  };

  const { error } = await supabase.from("expenses").insert(row);
  if (error) {
    return { ok: false, error: error.message };
  }

  console.log(
    `[parse-inbound-bill] "${parsed.vendor}" future_instalments: ${JSON.stringify(parsed.future_instalments ?? "MISSING")}`,
  );

  let scheduledBillsCreated = 0;
  if (matchedPropertyId) {
    const billType = mapBillType(parsed.bill_category, parsed.vendor);
    const billGroupId = `bg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const source = { fileName: input.pdfFileName, fileData: input.pdfBase64 };

    // Bills tab lives on property_bills, not expenses — without this row, the currently-due
    // instalment would only ever show up in Expenses/Documents, never in the Bills tab itself.
    await supabase.from("property_bills").insert({
      id: `bill_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      propertyId: matchedPropertyId,
      billType,
      amount: parsed.amount,
      dueDate: parsed.due_date,
      status: "Unpaid",
      providerName: parsed.vendor,
      bpayBillerCode: parsed.bpay_biller_code ?? undefined,
      bpayReference: parsed.bpay_reference ?? undefined,
      source: "Email",
      billGroupId,
      label: parsed.future_instalments?.length ? "Instalment 1" : undefined,
      lineItems: parsed.line_items?.length ? parsed.line_items : [{ description: parsed.vendor, amount: parsed.amount }],
      sourceFileName: source.fileName,
      sourceFileData: source.fileData,
      linkedExpenseId: row.id,
    });

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
    await upsertProviderFromBill(supabase, matchedPropertyId, billType, parsed);
    await updateAnnualRunningCost(
      supabase,
      matchedPropertyId,
      billType,
      parsed.amount,
      parsed.future_instalments ?? [],
    );
  }

  return { ok: true, expenseId: row.id, status, reviewReason, matchedPropertyId, scheduledBillsCreated };
}
