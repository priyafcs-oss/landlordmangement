import type { Expense, Provider, RentFrequency } from "./types";

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

function weeklyRentOf(rentAmount: number, frequency: RentFrequency): number {
  if (frequency === "Weekly") return rentAmount;
  if (frequency === "Fortnightly") return rentAmount / 2;
  return (rentAmount * 12) / 52; // Monthly
}

const TOLERANCE_RATE = 0.02;
const MIN_TOLERANCE = 2;

function buildResult(type: FeeCheckType, expected: number | undefined, actual: number, treatZeroAsMissing: boolean): FeeCheckResult {
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
    "managementFeePercent" | "lettingFeeAmount" | "lettingFeeWeeksRent" | "adminFeeAmount" | "leaseRenewalFeeAmount" | "inspectionFeeAmount"
  >;
  rentCollected: number;
  lines: FeeLine[];
  /** Matched tenant's rent, for a letting fee contracted as "N weeks' rent" rather than a flat $. */
  tenantRent?: { amount: number; frequency: RentFrequency };
}): FeeCheckResult[] {
  const { provider, rentCollected, lines, tenantRent } = params;

  const actualByType = new Map<FeeCheckType, number>();
  for (const line of lines) {
    // A line with no recognisable keyword in its vendor/category/description (an agency's own
    // name, a bare "Agency Fee"/"Commission" with no further detail) still overwhelmingly means
    // the recurring management fee — the only fee type charged on virtually every statement —
    // rather than something to silently drop from the total. Falls back to Management Fee instead
    // of vanishing, which previously made the whole line invisible to verification even though it
    // was a real, correctly-posted deduction.
    const type = classifyFeeLine(`${line.vendor ?? ""} ${line.category ?? ""} ${line.description ?? ""}`) ?? "Management Fee";
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
 * Turns a set of already-posted Expense rows back into FeeLine input — used for verifying a
 * whole past period (the on-demand report, EOFY) rather than a single statement still in review.
 * Relies on RentLedgerProposalCard.confirm having tagged every agent deduction with
 * category: "Property Agent Fees" and notes: the AI's raw fee-type text at posting time — before
 * that, itemName alone (usually just the agency's name) has no fee-type signal to classify on.
 */
export function collectAgentFeeLines(expenses: Expense[]): FeeLine[] {
  return expenses
    .filter((e) => e.category === "Property Agent Fees")
    .map((e) => ({ vendor: e.itemName, category: e.notes, amount: e.cost }));
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
