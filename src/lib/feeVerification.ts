import type { Expense, ExpenseCategory, Provider, RentFrequency } from "./types";

export type FeeCheckType = "Management Fee" | "Letting Fee" | "Admin Fee" | "Lease Renewal Fee" | "Inspection Fee";
export type FeeCheckStatus = "match" | "overcharge" | "undercharge" | "not_charged" | "unspecified";

export interface FeeCheckResult {
  type: FeeCheckType;
  /** null when the contract has no term for this fee at all — "unspecified" status, not a
   * computed variance, since there's nothing to compare the actual charge against. */
  expected: number | null;
  actual: number;
  variance: number | null;
  status: FeeCheckStatus;
}

/** One agent-charged line from a statement (or a posted Expense standing in for one) — vendor,
 * category and description are all fuzzy-matched together since which field actually carries the
 * "management fee" wording varies by source. */
export interface FeeLine {
  vendor?: string;
  /** The Expense's own payee field, when this line came from a posted Expense — distinct from
   * `vendor` (itemName), which is often just a free-text description rather than who was actually
   * paid. Only set for the collectAgentFeeLines path; a fresh AI-parsed statement line has no
   * separate payee, since `vendor` already IS who it was paid to. */
  providerName?: string;
  category?: string;
  description?: string;
  amount: number;
}

const CLASSIFY_PATTERNS: [FeeCheckType, RegExp][] = [
  ["Lease Renewal Fee", /renew/i],
  ["Letting Fee", /letting|leasing|new\s*tenant|tenant\s*placement/i],
  ["Inspection Fee", /inspect/i],
  ["Admin Fee", /admin|statement\s*fee/i],
  ["Management Fee", /manag/i],
];

/** Order matters — checked most-specific first so e.g. "lease renewal admin fee" lands on Lease
 * Renewal Fee rather than the much broader Admin Fee pattern. */
export function classifyFeeLine(text: string): FeeCheckType | null {
  for (const [type, pattern] of CLASSIFY_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

/** Non-fee deduction lines checked after classifyFeeLine finds no fee keyword and the line isn't
 * paid to the agent itself — a rent statement routinely deducts real bills (water usage, a
 * tradesperson's invoice) the agent paid on the owner's behalf, and those need their own ATO
 * category, not the agent's. Order matters for the same reason as CLASSIFY_PATTERNS — "water" is
 * checked before the Repairs & Maintenance catch-all so a water bill doesn't fall through to it. */
const NON_FEE_CATEGORY_PATTERNS: [ExpenseCategory, RegExp][] = [
  ["Water Charges", /\bwater\b/i],
  ["Gas", /\bgas\b/i],
  ["Electricity", /\belectricity\b/i],
  ["Council Rates", /council/i],
  ["Strata Levies", /\bstrata\b/i],
  ["Body Corporate Fees", /body\s*corp/i],
  ["Insurance", /insur/i],
  ["Pest Control", /\bpest\b/i],
  ["Gardening / Lawn Mowing", /garden|lawn/i],
  ["Cleaning", /\bclean/i],
];

/**
 * Maps one statement deduction line to the ATO expense category it actually belongs under, for
 * posting as an Expense — distinct from classifyFeeLine, which only asks "which fee type is
 * this" and is meaningless for the majority of deduction lines that aren't a fee at all. A line
 * counts as the agent's own charge (Property Agent Fees, or Letting Fees specifically) when it
 * either matches a fee keyword or was paid to the agent by name; everything else gets matched
 * against common bill/utility wording, falling back to Repairs & Maintenance — the most common
 * real shape of "agent paid a bill on the owner's behalf" — rather than defaulting to the agent's
 * own fee category, which would misattribute a tradesperson's invoice as agent income.
 */
export function categorizeAgentStatementLine(
  line: { vendor?: string; category?: string; description?: string },
  agentName?: string,
): ExpenseCategory {
  const blob = `${line.vendor ?? ""} ${line.category ?? ""} ${line.description ?? ""}`;
  const feeType = classifyFeeLine(blob);
  const payeeIsAgent = !!agentName && !!line.vendor && line.vendor.trim().toLowerCase() === agentName.trim().toLowerCase();
  if (feeType === "Letting Fee") return "Letting Fees";
  if (feeType || payeeIsAgent) return "Property Agent Fees";
  for (const [category, pattern] of NON_FEE_CATEGORY_PATTERNS) {
    if (pattern.test(blob)) return category;
  }
  return "Repairs & Maintenance";
}

function weeklyRentOf(rentAmount: number, frequency: RentFrequency): number {
  if (frequency === "Weekly") return rentAmount;
  if (frequency === "Fortnightly") return rentAmount / 2;
  return (rentAmount * 12) / 52; // Monthly
}

const TOLERANCE_RATE = 0.02;
const MIN_TOLERANCE = 2;

export function buildResult(type: FeeCheckType, expected: number | undefined, actual: number, treatZeroAsMissing: boolean): FeeCheckResult {
  if (expected === undefined) {
    return { type, expected: null, actual, variance: null, status: "unspecified" };
  }
  if (treatZeroAsMissing && actual === 0 && expected > 0) {
    return { type, expected, actual, variance: -expected, status: "not_charged" };
  }
  const tolerance = Math.max(MIN_TOLERANCE, expected * TOLERANCE_RATE);
  const variance = actual - expected;
  const status: FeeCheckStatus = Math.abs(variance) <= tolerance ? "match" : variance > 0 ? "overcharge" : "undercharge";
  return { type, expected, actual, variance, status };
}

/**
 * Compares agent-charged fee lines (from one rent statement, or aggregated across a whole
 * period) against a Provider's recorded management-agreement terms. Only produces a result for
 * a fee type that's either (a) Management Fee — checked every time rent was collected, since it
 * recurs on virtually every statement, even when the statement charged nothing so the landlord
 * notices a missing deduction, not just a wrong one — or (b) any other fee type that was actually
 * charged on this statement/period; a letting fee never being charged in a given month is normal,
 * not a discrepancy, so it's simply not reported on.
 */
export function verifyAgentFees(params: {
  provider: Pick<
    Provider,
    "name" | "managementFeePercent" | "lettingFeeAmount" | "lettingFeeWeeksRent" | "adminFeeAmount" | "leaseRenewalFeeAmount" | "inspectionFeeAmount"
  >;
  rentCollected: number;
  lines: FeeLine[];
  /** Matched tenant's rent, for a letting fee contracted as "N weeks' rent" rather than a flat $. */
  tenantRent?: { amount: number; frequency: RentFrequency };
}): FeeCheckResult[] {
  const { provider, rentCollected, lines, tenantRent } = params;
  const normalizedAgentName = provider.name.trim().toLowerCase();

  const actualByType = new Map<FeeCheckType, number>();
  for (const line of lines) {
    // A line with no recognisable fee keyword (a bare "Agency Fee"/"Commission" with no further
    // detail) still overwhelmingly means the recurring management fee — the only fee type charged
    // on virtually every statement — rather than something to silently drop from the total,
    // PROVIDED the line was actually paid to the agent itself (its vendor/payee name matches), or
    // is explicitly tagged with the dedicated fee category. Without that guard, a bill the agent
    // merely paid on the owner's behalf (a tradesperson invoice deducted from the same statement,
    // or a Repairs & Maintenance expense routed through the agent's trust account) would fall into
    // this same catch-all and inflate the management fee total with costs that have nothing to do
    // with it.
    const isFeeCategory = /property agent fees|letting fees/i.test(line.category ?? "");
    const payeeIsAgent = [line.vendor, line.providerName].some((v) => !!v && v.trim().toLowerCase() === normalizedAgentName);
    const type = classifyFeeLine(`${line.vendor ?? ""} ${line.category ?? ""} ${line.description ?? ""}`) ?? (isFeeCategory || payeeIsAgent ? "Management Fee" : null);
    if (!type) continue;
    actualByType.set(type, (actualByType.get(type) ?? 0) + line.amount);
  }

  const results: FeeCheckResult[] = [];

  const mgmtActual = actualByType.get("Management Fee") ?? 0;
  if (provider.managementFeePercent !== undefined && (rentCollected > 0 || mgmtActual > 0)) {
    // No rent recorded in this bucket (e.g. a monthly breakdown where the fee deduction landed in
    // a different month than the rent it was deducted from) still surfaces the actual charge
    // rather than silently dropping it — there's just nothing to compute an expected amount
    // against, so it reads as "unspecified" instead of a computed variance.
    const expected = rentCollected > 0 ? rentCollected * (provider.managementFeePercent / 100) : undefined;
    results.push(buildResult("Management Fee", expected, mgmtActual, rentCollected > 0));
  }

  const lettingActual = actualByType.get("Letting Fee") ?? 0;
  if (lettingActual > 0) {
    const weeklyRent = tenantRent ? weeklyRentOf(tenantRent.amount, tenantRent.frequency) : undefined;
    const expected = provider.lettingFeeAmount ?? (provider.lettingFeeWeeksRent && weeklyRent ? provider.lettingFeeWeeksRent * weeklyRent : undefined);
    results.push(buildResult("Letting Fee", expected, lettingActual, false));
  }

  const adminActual = actualByType.get("Admin Fee") ?? 0;
  if (adminActual > 0) {
    results.push(buildResult("Admin Fee", provider.adminFeeAmount, adminActual, false));
  }

  const renewalActual = actualByType.get("Lease Renewal Fee") ?? 0;
  if (renewalActual > 0) {
    results.push(buildResult("Lease Renewal Fee", provider.leaseRenewalFeeAmount, renewalActual, false));
  }

  const inspectionActual = actualByType.get("Inspection Fee") ?? 0;
  if (inspectionActual > 0) {
    results.push(buildResult("Inspection Fee", provider.inspectionFeeAmount, inspectionActual, false));
  }

  return results;
}

/**
 * Rolls a set of per-period FeeCheckResult[] (one array per month, from repeated verifyAgentFees
 * calls) up into a single result per fee type for the whole span — e.g. an FY total, so "was the
 * admin fee right this year" can be answered as one flag instead of twelve. Sums actual and
 * expected across every period a type appeared in, then re-derives status with the same
 * tolerance/not-charged rule buildResult already applies per period. Only Management Fee treats a
 * zero actual against a positive expected as "not charged" — the same asymmetry verifyAgentFees
 * applies per period, since a one-off fee (letting, renewal, inspection) simply not occurring in a
 * given span is normal, not a missed charge.
 */
export function summarizeFeeChecksByType(periodResults: FeeCheckResult[][]): FeeCheckResult[] {
  const byType = new Map<FeeCheckType, { actual: number; expected: number; hasExpected: boolean }>();
  for (const results of periodResults) {
    for (const r of results) {
      const entry = byType.get(r.type) ?? { actual: 0, expected: 0, hasExpected: false };
      entry.actual += r.actual;
      if (r.expected !== null) {
        entry.expected += r.expected;
        entry.hasExpected = true;
      }
      byType.set(r.type, entry);
    }
  }
  return [...byType.entries()].map(([type, e]) =>
    buildResult(type, e.hasExpected ? e.expected : undefined, e.actual, type === "Management Fee"),
  );
}

/**
 * Turns a set of already-posted Expense rows back into FeeLine input — used for verifying a
 * whole past period (the on-demand report, EOFY) rather than a single statement still in review.
 * Takes whatever set of expenses the caller has already decided are agent-fee lines (see
 * isAgentFeeExpense below) — doesn't re-filter by category itself, so a manually-entered expense
 * that was categorised as something other than "Property Agent Fees" (e.g. left at the default,
 * or picked "Letting Fees" instead) still gets counted as long as the caller included it.
 * Classification passes both the Expense's own category ("Letting Fees" is a strong signal on its
 * own) and `notes` (the AI's raw free-text fee-type at posting time, e.g. "management_fees") —
 * before that, itemName alone (often just the agency's name) may have no fee-type keyword at all.
 */
export function collectAgentFeeLines(expenses: Expense[]): FeeLine[] {
  return expenses.map((e) => ({
    vendor: e.itemName,
    providerName: e.providerName,
    category: [e.category, e.notes].filter(Boolean).join(" "),
    amount: e.cost,
  }));
}

/** An expense counts toward agent-fee verification when it's either tagged with the dedicated
 * "Property Agent Fees"/"Letting Fees" category, OR paid to whoever the property's managing agent
 * is (by name) — covers a manually-entered fee that was left under a different/default category,
 * which the category-only check used to silently exclude from every total. */
export function isAgentFeeExpense(expense: Pick<Expense, "category" | "providerName">, agentName: string): boolean {
  if (expense.category === "Property Agent Fees" || expense.category === "Letting Fees") return true;
  return !!expense.providerName && expense.providerName.trim().toLowerCase() === agentName.trim().toLowerCase();
}

/** Whether a Provider has recorded enough of its agreement to make verification worthwhile at
 * all — used to decide whether to show the fee-check UI in the first place. */
export function hasFeeTerms(provider: Pick<Provider, "managementFeePercent" | "lettingFeeAmount" | "lettingFeeWeeksRent" | "adminFeeAmount" | "leaseRenewalFeeAmount" | "inspectionFeeAmount" | "advertisingFeeAmount">): boolean {
  return (
    provider.managementFeePercent !== undefined ||
    provider.lettingFeeAmount !== undefined ||
    provider.lettingFeeWeeksRent !== undefined ||
    provider.adminFeeAmount !== undefined ||
    provider.leaseRenewalFeeAmount !== undefined ||
    provider.inspectionFeeAmount !== undefined ||
    provider.advertisingFeeAmount !== undefined
  );
}
