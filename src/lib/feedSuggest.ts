import { RENT_INCOME_CATEGORY } from "@/lib/calculations";
import { findMatchingUnpaidBill } from "@/lib/billMatch";
import { namesLooselyMatch } from "@/lib/providerMatch";
import type {
  ExpenseCategory,
  PropertyBill,
  Provider,
  ProviderProperty,
  Tenant,
} from "@/lib/types";

/** Was this tenant living there on `date`? (A lapsed leaseExpiry usually just means periodic, so
 * only an actual vacating date or a lease that hadn't started yet rules them out.) */
function tenantActiveOn(t: Tenant, date: string): boolean {
  if (t.leaseStart && t.leaseStart > date) return false;
  if (t.vacatingDate && t.vacatingDate < date) return false;
  return true;
}

/** Lowercase, punctuation → spaces, padded so `has(" word ")` is a whole-word test. */
function words(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function hasWords(haystack: string, phrase: string): boolean {
  const p = words(phrase).trim();
  return p.length > 0 && haystack.includes(` ${p} `);
}

/** Money moving between the landlord's own accounts — never rent, never an expense. */
const TRANSFER_PATTERN =
  /\b(internal transfer|linked acc(oun)?t|own acc(oun)?t|between accounts|to offset|from offset|transfer (to|from) (savings|offset|linked|own))\b/i;
/** Income that isn't from a tenant — the landlord's salary, interest, refunds, government. */
const NON_RENT_INCOME_PATTERN =
  /\b(salary|salaries|payroll|wages?|pay ?run|net pay|interest|dividend|refund|reversal|cashback|centrelink|ato|tax return)\b/i;

export type NonPropertyKind = "transfer" | "salary or other income";

/** Why a line is clearly not a property transaction, or null. */
export function nonPropertyReason(
  description: string,
  direction: "in" | "out",
): NonPropertyKind | null {
  if (TRANSFER_PATTERN.test(description)) return "transfer";
  if (direction === "in" && NON_RENT_INCOME_PATTERN.test(description))
    return "salary or other income";
  return null;
}

export interface TenantTextMatch {
  tenant: Tenant;
  via: "reference" | "name";
}

/**
 * Which tenant a bank line's text names: their bank reference, account holder or full name as a
 * phrase, or their surname as a whole word. Never a first name or a fragment on its own — "Sam" or
 * "link" turn up in plenty of descriptions that have nothing to do with the tenant. Shared by the
 * Rental hub's Bank Feed Import and the bank-account feed's suggestions. Tenants active on `date`
 * win a tie, so a past tenant with the same surname doesn't take a current tenant's deposit.
 */
export function matchTenantByText(
  tenants: Tenant[],
  text: string,
  date?: string,
): TenantTextMatch | undefined {
  const hay = words(text);
  const ordered = date
    ? [...tenants].sort((a, b) => Number(tenantActiveOn(b, date)) - Number(tenantActiveOn(a, date)))
    : tenants;
  const byRef = ordered.find((t) => {
    const ref = (t.bankReference ?? "").trim();
    return ref.replace(/[^a-z0-9]/gi, "").length >= 4 && hasWords(hay, ref);
  });
  if (byRef) return { tenant: byRef, via: "reference" };
  const byName = ordered.find((t) => {
    const holder = (t.bankAccountHolder ?? "").trim();
    if (holder.length >= 5 && hasWords(hay, holder)) return true;
    if (hasWords(hay, t.name) && words(t.name).trim().includes(" ")) return true;
    const surname = words(t.name).trim().split(" ").pop() ?? "";
    return surname.length >= 3 && hasWords(hay, surname);
  });
  return byName ? { tenant: byName, via: "name" } : undefined;
}

/** A whole number (1–8) of the tenant's rent periods, to within $1. Rent is paid exactly; a
 * percentage tolerance let a $4,682 salary pass as 4 × $1,170 (±2% is ±$94 at that size). */
export function isRentMultiple(amount: number, rentAmount: number): boolean {
  if (!(rentAmount > 0) || !(amount > 0)) return false;
  const periods = Math.round(amount / rentAmount);
  if (periods < 1 || periods > 8) return false;
  return Math.abs(amount - periods * rentAmount) <= 1;
}

/** Descriptions that are almost always a rental-property cost, by category. Deliberately leaves
 * out things a household also pays (electricity, gas, phone, groceries) — those would flag every
 * personal bill on an everyday account. */
const EXPENSE_KEYWORDS: [RegExp, ExpenseCategory][] = [
  [/\b(council|rates notice|shire)\b/i, "Council Rates"],
  [/\b(strata|owners corp(oration)?|body corp(orate)?)\b/i, "Strata Levies"],
  [/\b(land tax|revenue nsw|state revenue)\b/i, "Land Tax"],
  [/\b(landlord insurance|terri scheme|ebm insurance)\b/i, "Insurance"],
  [/\b(water rates|sydney water|hunter water)\b/i, "Water Charges"],
  [
    /\b(plumb(er|ing)|electrician|handyman|locksmith|glazier|roofing|smoke alarm|repairs?)\b/i,
    "Repairs & Maintenance",
  ],
  [/\b(pest control|termite)\b/i, "Pest Control"],
  [/\b(lawn|mowing|gardening|gardener)\b/i, "Gardening / Lawn Mowing"],
  [/\b(management fee|letting fee|property management|real estate)\b/i, "Property Agent Fees"],
];

export function keywordExpenseCategory(description: string): ExpenseCategory | undefined {
  return EXPENSE_KEYWORDS.find(([re]) => re.test(description))?.[1];
}

export interface FeedLine {
  date: string;
  description: string;
  amount: number;
  direction: "in" | "out";
  providerId?: string;
  /** The property the statement itself was filed against, if any. */
  propertyId?: string;
}

export interface FeedSuggestion {
  /** "rent" → a tenant's ledger; "bill" → marks an unpaid bill paid; "expense" → a new Expense. */
  kind: "rent" | "bill" | "expense";
  category: string;
  /** Unset when the line looks like a property expense but which property isn't known — it's
   * still flagged, it just can't be accepted in one click. */
  propertyId?: string;
  tenantId?: string;
  billId?: string;
  /** Short human label, e.g. "Rent · Jane Doe". */
  label: string;
  /** Why it was suggested, for a tooltip. */
  reason: string;
}

export interface SuggestContext {
  tenants: Tenant[];
  providers: Provider[];
  providerProperties: ProviderProperty[];
  bills: PropertyBill[];
}

function rentSuggestion(line: FeedLine, ctx: SuggestContext): FeedSuggestion | null {
  const m = matchTenantByText(ctx.tenants, line.description, line.date);
  if (!m || !tenantActiveOn(m.tenant, line.date)) return null;
  if (m.via === "name" && !isRentMultiple(line.amount, m.tenant.rentAmount)) return null;
  return {
    kind: "rent",
    category: RENT_INCOME_CATEGORY,
    propertyId: m.tenant.propertyId,
    tenantId: m.tenant.id,
    label: `Rent · ${m.tenant.name}`,
    reason:
      m.via === "reference"
        ? "Description contains the tenant's bank reference"
        : "Description names the tenant and the amount is a whole number of rent periods",
  };
}

function expenseSuggestion(line: FeedLine, ctx: SuggestContext): FeedSuggestion | null {
  const bill = findMatchingUnpaidBill(ctx.bills, {
    propertyId: line.propertyId,
    vendorOrDescription: line.description,
    amount: line.amount,
    date: line.date,
  });
  if (bill) {
    return {
      kind: "bill",
      category:
        bill.category ?? keywordExpenseCategory(line.description) ?? "Sundry Rental Expenses",
      propertyId: bill.propertyId,
      billId: bill.id,
      label: `Pays bill · ${bill.providerName || bill.billType}`,
      reason: `Matches the unpaid ${bill.providerName || bill.billType} bill due ${bill.dueDate} — marks it paid`,
    };
  }

  const provider =
    (line.providerId ? ctx.providers.find((p) => p.id === line.providerId) : undefined) ??
    ctx.providers.find((p) => namesLooselyMatch(p.name, line.description));
  const keyword = keywordExpenseCategory(line.description);
  if (!provider && !keyword) return null;
  const providerProps = provider
    ? ctx.providerProperties.filter((pp) => pp.providerId === provider.id)
    : [];
  const propertyId =
    line.propertyId ?? (providerProps.length === 1 ? providerProps[0].propertyId : undefined);
  const category = provider?.defaultCategory ?? keyword ?? "Sundry Rental Expenses";
  return {
    kind: "expense",
    category,
    propertyId,
    label: `${category}${provider ? ` · ${provider.name}` : ""}`,
    reason: provider
      ? `Paid to ${provider.name}, one of your providers`
      : `Description looks like a property expense (${category})`,
  };
}

/**
 * Rule-based suggestion for how to record one bank-feed line, or null when it isn't confidently a
 * property transaction. Deliberately conservative — a wrong suggestion accepted in bulk is worse
 * than none:
 * - Transfers between the landlord's own accounts, salary and other non-tenant income are never
 *   suggested.
 * - A deposit is rent only when its text names a tenant (bank reference, or name AND a whole number
 *   of rent periods to the dollar). An amount alone never decides it.
 * - A debit is flagged when it pays an unpaid bill, is paid to a known provider, or reads like a
 *   property cost (rates, strata, repairs, ...).
 */
export function suggestFeedLine(line: FeedLine, ctx: SuggestContext): FeedSuggestion | null {
  if (nonPropertyReason(line.description, line.direction)) return null;
  return line.direction === "in" ? rentSuggestion(line, ctx) : expenseSuggestion(line, ctx);
}

export interface ParsedFeedLine {
  amount: number;
  /** ISO date, when the line had one (YYYY-MM-DD or DD/MM/YYYY). */
  date?: string;
}

/** Reads the date and amount off one pasted bank-feed line (Rental hub → Bank Feed Import). The
 * date is taken off first, otherwise "2026-07-01 ... $720" read its amount as 2026. */
export function parseBankFeedLine(line: string): ParsedFeedLine | null {
  const iso = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const dmy = iso ? null : line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const date = iso
    ? iso[0]
    : dmy
      ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
      : undefined;
  const rest = iso ? line.replace(iso[0], " ") : dmy ? line.replace(dmy[0], " ") : line;
  const money =
    rest.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/) ?? rest.match(/\b(\d[\d,]*(?:\.\d{1,2})?)\b/);
  if (!money) return null;
  const amount = parseFloat(money[1].replace(/,/g, ""));
  return amount ? { amount, date } : null;
}
