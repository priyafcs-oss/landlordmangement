/**
 * The ONE copy of the bill-type and expense-category classifiers, shared by the edge functions
 * (parse-inbound-bill/core-parser.ts re-exports these) and the browser app (src/lib/calculations.ts
 * re-exports these). Dependency-free on purpose so both runtimes can import it. There used to be a
 * hand-synced copy in each, and the browser's drifted — it had no "Land Tax", and filed "water
 * rates" as Council Rates (an ordering bug fixed here but never there).
 */

export const BILL_TYPES = [
  "Water",
  "Council Rates",
  "Land Tax",
  "Strata",
  "Insurance",
  "Electricity",
  "Gas",
  "Other",
] as const;
export type BillType = (typeof BILL_TYPES)[number];

/** Vendor-name signals for a one-off trade/repair job (a plumber, electrician, aircon tech, ...).
 * Checked before the narrower utility keywords in both mapBillType/mapExpenseCategory below,
 * since a trade business's own name very often contains a utility word as a substring — e.g.
 * "BGS Airconditioning and Electricals" contains "electric", which would otherwise misfile a
 * one-off repair invoice as a recurring Electricity bill instead of Repairs & Maintenance. */
const TRADE_KEYWORDS = [
  "plumb",
  "electrician",
  "electrical",
  "repair",
  "maintenance",
  "handyman",
  "aircon",
  "locksmith",
];
function looksLikeTrade(haystack: string): boolean {
  return TRADE_KEYWORDS.some((k) => haystack.includes(k));
}

/** Maps Gemini's free-text bill_category (or the vendor name, as a fallback) onto the app's BillType union. */
export function mapBillType(
  billCategory: string | null | undefined,
  vendor?: string | null,
): BillType {
  const exact = BILL_TYPES.find(
    (t) => t.toLowerCase() === (billCategory ?? "").trim().toLowerCase(),
  );
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
  if (
    haystack.includes("land tax") ||
    haystack.includes("revenue nsw") ||
    haystack.includes("state revenue office")
  )
    return "Land Tax";
  if (haystack.includes("council") || haystack.includes("rates")) return "Council Rates";
  if (haystack.includes("strata") || haystack.includes("owners corp")) return "Strata";
  if (haystack.includes("insur")) return "Insurance";
  if (haystack.includes("electric") || haystack.includes("power")) return "Electricity";
  if (haystack.includes("gas")) return "Gas";
  return "Other";
}

/** The bill-shaped categories from the app's "Running Expenses" ATO taxonomy (src/lib/types.ts
 * CATEGORY_GROUPS). This file can't import from src/ (edge functions can't), so the names are
 * listed here; tests/unit/classify.test.ts fails if one isn't a real ExpenseCategory. */
export const EXPENSE_CATEGORIES = [
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
export function mapExpenseCategory(
  expenseCategory: string | null | undefined,
  vendor?: string | null,
): BillExpenseCategory {
  const exact = EXPENSE_CATEGORIES.find(
    (c) => c.toLowerCase() === (expenseCategory ?? "").trim().toLowerCase(),
  );
  if (exact) return exact;
  const haystack = `${expenseCategory ?? ""} ${vendor ?? ""}`.toLowerCase();
  // A trade/repair vendor's own name is a stronger, more specific signal than the generic utility
  // substrings below — checked first so it can't be caught by "electric"/"gas" (see TRADE_KEYWORDS
  // comment above mapBillType).
  if (looksLikeTrade(haystack)) return "Repairs & Maintenance";
  // Checked first — same "water_rates" vs. council/rates ordering issue as mapBillType above.
  if (haystack.includes("water")) return "Water Charges";
  if (
    haystack.includes("land tax") ||
    haystack.includes("revenue nsw") ||
    haystack.includes("state revenue office")
  )
    return "Land Tax";
  if (haystack.includes("council") || haystack.includes("rates")) return "Council Rates";
  if (haystack.includes("strata") || haystack.includes("owners corp")) return "Strata Levies";
  if (haystack.includes("body corp")) return "Body Corporate Fees";
  if (haystack.includes("insur")) return "Insurance";
  if (haystack.includes("electric") || haystack.includes("power")) return "Electricity";
  if (haystack.includes("gas")) return "Gas";
  if (haystack.includes("pest")) return "Pest Control";
  if (haystack.includes("garden") || haystack.includes("lawn")) return "Gardening / Lawn Mowing";
  if (haystack.includes("clean")) return "Cleaning";
  if (haystack.includes("legal") || haystack.includes("lawyer") || haystack.includes("solicitor"))
    return "Legal Fees";
  if (
    haystack.includes("account") ||
    haystack.includes("tax agent") ||
    haystack.includes("bookkeep")
  )
    return "Tax Agent / Accounting Fees";
  if (
    haystack.includes("telco") ||
    haystack.includes("internet") ||
    haystack.includes("phone") ||
    haystack.includes("telstra") ||
    haystack.includes("optus")
  )
    return "Telephone / Internet";
  if (
    haystack.includes("advertis") ||
    haystack.includes("marketing") ||
    haystack.includes("listing")
  )
    return "Advertising for Tenants";
  return "Sundry Rental Expenses";
}
