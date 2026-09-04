import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedBillFields } from "./types.ts";

const BILL_PROMPT = `You are extracting structured invoice data from an Australian property bill email (council rates, water, strata, or similar).
Extract the fields defined in the response schema as strict JSON.
- due_date must be formatted YYYY-MM-DD, and is the instalment that is CURRENTLY due / due soonest.
- bpay_biller_code and bpay_reference must be null if the bill has no BPAY details.
- bill_category must be one of: Water, Council Rates, Land Tax, Strata, Insurance, Electricity, Gas, Other.
  A land tax assessment notice (from a state/territory revenue office, e.g. Revenue NSW, State
  Revenue Office Vic) is "Land Tax", not "Council Rates" — the two are separate taxing authorities
  even though both are annual government notices.
- expense_category is a SEPARATE, more specific field — pick the single best match to what this
  bill/receipt is actually FOR, from: Advertising for Tenants, Body Corporate Fees, Cleaning,
  Council Rates, Gardening / Lawn Mowing, Insurance, Land Tax, Legal Fees, Pest Control, Repairs &
  Maintenance, Strata Levies, Water Charges, Electricity, Gas, Telephone / Internet, Tax Agent /
  Accounting Fees, Sundry Rental Expenses. Use the vendor name and line items to judge this, not
  just bill_category — e.g. a plumber's invoice is "Repairs & Maintenance", a pest inspection is
  "Pest Control", a lawn/garden service is "Gardening / Lawn Mowing", an accountant's tax return
  fee is "Tax Agent / Accounting Fees". Only use "Sundry Rental Expenses" when nothing else on this
  list genuinely fits — it is a last resort, not a default.
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
  amounts must sum to exactly the top-level "amount" field (the current instalment's total).
- Many Australian rates notices only itemise the FULL YEAR's charges (e.g. "General Rate $1,200,
  Waste Levy $432, Stormwater Levy $180" totalling the annual amount), separately from the
  per-instalment payment schedule. If the only breakdown you can find is for the full year rather
  than the current instalment, divide each of those annual amounts by the number of instalments
  for the year (4 for quarterly, 2 for half-yearly, 1 if paid in full) and report those divided
  figures as the line items — keep the original descriptions, and the divided amounts must still
  sum to the top-level "amount" field. Only fall back to a single line item (description = the
  vendor/bill type, amount = the total) if you genuinely cannot find ANY itemised breakdown
  anywhere on the notice, at either the annual or instalment level.
- addressed_to: the billing/account name the notice is addressed to (e.g. the name on the account),
  if printed — null if not shown. Do not guess or invent this.`;

/** Folds known Provider directory vendor names into the extraction prompt so Gemini normalizes a
 * vendor's spelling/formatting against what's already on file (e.g. "AGL" vs. "AGL Energy Pty
 * Ltd") instead of transcribing the notice's own wording verbatim — cuts down near-duplicate
 * Provider rows being created for the same real-world vendor. Mirrors classify.ts's
 * buildClassifyPrompt(knownEntityNames) pattern. */
function buildBillPrompt(knownProviders: { name: string; abn: string | null }[]): string {
  if (knownProviders.length === 0) return BILL_PROMPT;
  const list = knownProviders.map((p) => (p.abn ? `${p.name} (ABN ${p.abn})` : p.name)).join(", ");
  return `${BILL_PROMPT}

This landlord's known vendors/billers already on file are: ${list}. If the vendor printed on this
notice is the same real-world vendor as one of these (allowing for punctuation, legal-suffix, or
capitalisation differences — e.g. "AGL" vs. "AGL Energy Pty Ltd"), report the vendor field using
EXACTLY that on-file spelling instead of the notice's own wording. Only do this when you are
confident it's the same vendor — never rename to an unrelated on-file name.`;
}

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
    expense_category: { type: "STRING" },
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
    addressed_to: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: [
    "vendor",
    "amount",
    "due_date",
    "property_address",
    "ato_category",
    "bill_category",
    "expense_category",
    "future_instalments",
    "line_items",
    "confidence",
  ],
};

/** Shared with extract-bill (the stateless upload-and-preview endpoint behind the Add Bill dialog)
 * and parse-bill (the staging/direct-write intake pipeline). knownProviders is optional and
 * additive — extract-bill doesn't pass one, and omitting it behaves exactly as before. */
export async function extractBillFields(
  input: NormalizedBillInput,
  knownProviders: { name: string; abn: string | null }[] = [],
): Promise<ParsedBillFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(buildBillPrompt(knownProviders), input);
  return callGeminiJSON<ParsedBillFields>(apiKey, parts, BILL_SCHEMA);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateParsedBill(parsed: ParsedBillFields): string | null {
  if (!parsed.vendor || typeof parsed.vendor !== "string") return "Missing vendor";
  if (typeof parsed.amount !== "number" || !(parsed.amount > 0)) return "Missing or invalid amount";
  if (!DATE_RE.test(parsed.due_date ?? "")) return "Missing or invalid due_date";
  return null;
}

/** Maps Gemini's free-text ato_category onto the app's existing two-value tax category union. */
export function mapAtoCategory(category: string): "Immediate Deduction" | "Capital Works" {
  const c = (category ?? "").toLowerCase();
  if (c.includes("capital") || c.includes("improvement") || c.includes("renovation")) {
    return "Capital Works";
  }
  return "Immediate Deduction";
}

export const BILL_TYPES = ["Water", "Council Rates", "Land Tax", "Strata", "Insurance", "Electricity", "Gas", "Other"] as const;
export type BillType = (typeof BILL_TYPES)[number];

/** Vendor-name signals for a one-off trade/repair job (a plumber, electrician, aircon tech, ...).
 * Checked before the narrower utility keywords in both mapBillType/mapExpenseCategory below,
 * since a trade business's own name very often contains a utility word as a substring — e.g.
 * "BGS Airconditioning and Electricals" contains "electric", which would otherwise misfile a
 * one-off repair invoice as a recurring Electricity bill instead of Repairs & Maintenance. */
const TRADE_KEYWORDS = ["plumb", "electrician", "electrical", "repair", "maintenance", "handyman", "aircon", "locksmith"];
function looksLikeTrade(haystack: string): boolean {
  return TRADE_KEYWORDS.some((k) => haystack.includes(k));
}

/** Maps Gemini's free-text bill_category (or the vendor name, as a fallback) onto the app's BillType union. */
export function mapBillType(billCategory: string, vendor: string): BillType {
  const exact = BILL_TYPES.find((t) => t.toLowerCase() === (billCategory ?? "").trim().toLowerCase());
  if (exact) return exact;
  const haystack = `${billCategory ?? ""} ${vendor ?? ""}`.toLowerCase();
  // A trade/repair vendor is never one of the fixed recurring-bill types above — checked first so
  // it can't be caught by the "electric"/"gas" substrings below (see TRADE_KEYWORDS comment).
  if (looksLikeTrade(haystack)) return "Other";
  // Checked first — "water_rates"/"water rates" contains "rates" too, which would otherwise hit
  // the council/rates fallback below and misfile a water bill as Council Rates. Same reasoning for
  // land tax: it's a distinct taxing authority from council rates, so it's checked before the
  // generic "rates" substring would otherwise catch it too.
  if (haystack.includes("water")) return "Water";
  if (haystack.includes("land tax") || haystack.includes("revenue nsw") || haystack.includes("state revenue office")) return "Land Tax";
  if (haystack.includes("council") || haystack.includes("rates")) return "Council Rates";
  if (haystack.includes("strata") || haystack.includes("owners corp")) return "Strata";
  if (haystack.includes("insur")) return "Insurance";
  if (haystack.includes("electric") || haystack.includes("power")) return "Electricity";
  if (haystack.includes("gas")) return "Gas";
  return "Other";
}

/** The app's own "Running Expenses" ATO category taxonomy (src/lib/types.ts CATEGORY_GROUPS) —
 * duplicated here since an edge function can't import from src/. Kept in sync by hand; a category
 * added there for a genuinely bill-shaped expense should be added here too. */
const EXPENSE_CATEGORIES = [
  "Advertising for Tenants",
  "Body Corporate Fees",
  "Cleaning",
  "Council Rates",
  "Gardening / Lawn Mowing",
  "Insurance",
  "Land Tax",
  "Legal Fees",
  "Pest Control",
  "Repairs & Maintenance",
  "Strata Levies",
  "Water Charges",
  "Electricity",
  "Gas",
  "Telephone / Internet",
  "Tax Agent / Accounting Fees",
  "Sundry Rental Expenses",
] as const;
export type BillExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Maps Gemini's free-text expense_category (or a vendor/description fallback) onto the app's
 * ExpenseCategory taxonomy — this is what actually drives the Category field on Add Bill/Add
 * Transaction, since bill_category's 7 fixed values can't represent most non-utility bills (a
 * repair invoice, pest control, gardening, ...). Falls back to keyword matching against the
 * vendor name (same idea as mapBillType) so a badly-extracted expense_category still lands
 * somewhere better than the generic default when the vendor name itself is a strong signal. */
export function mapExpenseCategory(expenseCategory: string, vendor: string): BillExpenseCategory {
  const exact = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === (expenseCategory ?? "").trim().toLowerCase());
  if (exact) return exact;
  const haystack = `${expenseCategory ?? ""} ${vendor ?? ""}`.toLowerCase();
  // A trade/repair vendor's own name is a stronger, more specific signal than the generic utility
  // substrings below — checked first so it can't be caught by "electric"/"gas" (see TRADE_KEYWORDS
  // comment above mapBillType).
  if (looksLikeTrade(haystack)) return "Repairs & Maintenance";
  // Checked first — same "water_rates" vs. council/rates ordering issue as mapBillType above.
  if (haystack.includes("water")) return "Water Charges";
  if (haystack.includes("land tax") || haystack.includes("revenue nsw") || haystack.includes("state revenue office")) return "Land Tax";
  if (haystack.includes("council") || haystack.includes("rates")) return "Council Rates";
  if (haystack.includes("strata") || haystack.includes("owners corp")) return "Strata Levies";
  if (haystack.includes("body corp")) return "Body Corporate Fees";
  if (haystack.includes("insur")) return "Insurance";
  if (haystack.includes("electric") || haystack.includes("power")) return "Electricity";
  if (haystack.includes("gas")) return "Gas";
  if (haystack.includes("pest")) return "Pest Control";
  if (haystack.includes("garden") || haystack.includes("lawn")) return "Gardening / Lawn Mowing";
  if (haystack.includes("clean")) return "Cleaning";
  if (haystack.includes("legal") || haystack.includes("lawyer") || haystack.includes("solicitor")) return "Legal Fees";
  if (haystack.includes("account") || haystack.includes("tax agent") || haystack.includes("bookkeep")) return "Tax Agent / Accounting Fees";
  if (haystack.includes("telco") || haystack.includes("internet") || haystack.includes("phone") || haystack.includes("telstra") || haystack.includes("optus"))
    return "Telephone / Internet";
  if (haystack.includes("advertis") || haystack.includes("marketing") || haystack.includes("listing"))
    return "Advertising for Tenants";
  return "Sundry Rental Expenses";
}
