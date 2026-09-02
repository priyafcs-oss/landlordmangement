import type { Expense, ExpenseCategory, FeeFrequency, ProviderAgreement, RentFrequency } from "./types";

/** The subset of a ProviderAgreement's fields verification actually needs — lets a caller pass
 * either a real ProviderAgreement row or a plain object built ad hoc (e.g. from an AI-extracted
 * proposal payload not yet saved) without pulling in id/providerId/propertyId/contract-file noise. */
export type AgreementFeeTerms = Pick<
  ProviderAgreement,
  | "managementFeePercent"
  | "lettingFeeAmount"
  | "lettingFeeWeeksRent"
  | "adminFeeAmount"
  | "adminFeeFrequency"
  | "leaseRenewalFeeAmount"
  | "inspectionFeeAmount"
  | "advertisingFeeAmount"
> & {
  /** Optional here (unlike the DB row, where it's required) so an ad hoc terms object built from
   * an AI-extracted proposal not yet saved — which has no GST flag yet — can still be passed in. */
  gstApplicable?: boolean;
};

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

/** Classifies each fee line to a FeeCheckType and sums amounts by type — the shared core of both
 * verifyAgentFees (one statement/period) and reconcileFlatFees (a whole FY at once). A line with
 * no recognisable fee keyword (a bare "Agency Fee"/"Commission" with no further detail) still
 * overwhelmingly means the recurring management fee — the only fee type charged on virtually every
 * statement — rather than something to silently drop from the total, PROVIDED the line was
 * actually paid to the agent itself (its vendor/payee name matches), or is explicitly tagged with
 * the dedicated fee category. Without that guard, a bill the agent merely paid on the owner's
 * behalf (a tradesperson invoice deducted from the same statement, or a Repairs & Maintenance
 * expense routed through the agent's trust account) would fall into this same catch-all and
 * inflate the management fee total with costs that have nothing to do with it. */
function actualTotalsByType(lines: FeeLine[], agentName: string): Map<FeeCheckType, number> {
  const normalizedAgentName = agentName.trim().toLowerCase();
  const totals = new Map<FeeCheckType, number>();
  for (const line of lines) {
    const isFeeCategory = /property agent fees|letting fees/i.test(line.category ?? "");
    const payeeIsAgent = [line.vendor, line.providerName].some((v) => !!v && v.trim().toLowerCase() === normalizedAgentName);
    const type = classifyFeeLine(`${line.vendor ?? ""} ${line.category ?? ""} ${line.description ?? ""}`) ?? (isFeeCategory || payeeIsAgent ? "Management Fee" : null);
    if (!type) continue;
    totals.set(type, (totals.get(type) ?? 0) + line.amount);
  }
  return totals;
}

/** GST multiplier applied to any computed "expected" amount before it's compared against the
 * actual (GST-inclusive) charge — see ProviderAgreement.gstApplicable. */
function gstMultiplierOf(agreement: Pick<AgreementFeeTerms, "gstApplicable">): number {
  return agreement.gstApplicable ? 1.1 : 1;
}

/**
 * Compares agent-charged fee lines (from one rent statement, or aggregated across a whole
 * period) against a provider's recorded management-agreement terms. Only produces a result for
 * a fee type that's either (a) Management Fee — checked every time rent was collected, since it
 * recurs on virtually every statement, even when the statement charged nothing so the landlord
 * notices a missing deduction, not just a wrong one — or (b) any other requested fee type that was
 * actually charged on this statement/period; a letting fee never being charged in a given month is
 * normal, not a discrepancy, so it's simply not reported on.
 *
 * Admin Fee, Lease Renewal Fee and Inspection Fee are flat contracted amounts, not a per-period
 * charge — comparing the raw contracted amount against every period it happens to recur in (e.g.
 * a $66/year admin fee charged on every monthly statement) re-adds the full amount as "expected"
 * each time and overstates the true annual figure once summed across many calls. Callers that sum
 * results across more than one call (the Fee Verification tab, EOFY) should pass
 * `feeTypes: ["Management Fee", "Letting Fee"]` here to restrict this function to the two fee
 * types that genuinely are per-period/per-transaction, and use `reconcileFlatFees` separately,
 * once per FY, for the other three. A single-statement review (RentLedgerProposalCard) isn't
 * summed anywhere, so it can safely omit `feeTypes` and see every fee type this one statement
 * actually charged.
 */
export function verifyAgentFees(params: {
  agentName: string;
  agreement: AgreementFeeTerms;
  rentCollected: number;
  lines: FeeLine[];
  /** Matched tenant's rent, for a letting fee contracted as "N weeks' rent" rather than a flat $. */
  tenantRent?: { amount: number; frequency: RentFrequency };
  /** Restricts which fee types are computed/returned — see the doc comment above. Defaults to all
   * five types. */
  feeTypes?: FeeCheckType[];
}): FeeCheckResult[] {
  const { agentName, agreement, rentCollected, lines, tenantRent, feeTypes } = params;
  const wants = (t: FeeCheckType) => !feeTypes || feeTypes.includes(t);
  const gstMultiplier = gstMultiplierOf(agreement);
  const actualByType = actualTotalsByType(lines, agentName);
  const results: FeeCheckResult[] = [];

  if (wants("Management Fee")) {
    const mgmtActual = actualByType.get("Management Fee") ?? 0;
    if (agreement.managementFeePercent !== undefined && (rentCollected > 0 || mgmtActual > 0)) {
      // No rent recorded in this bucket (e.g. a monthly breakdown where the fee deduction landed
      // in a different month than the rent it was deducted from) still surfaces the actual charge
      // rather than silently dropping it — there's just nothing to compute an expected amount
      // against, so it reads as "unspecified" instead of a computed variance.
      const expected = rentCollected > 0 ? rentCollected * (agreement.managementFeePercent / 100) * gstMultiplier : undefined;
      results.push(buildResult("Management Fee", expected, mgmtActual, rentCollected > 0));
    }
  }

  if (wants("Letting Fee")) {
    const lettingActual = actualByType.get("Letting Fee") ?? 0;
    if (lettingActual > 0) {
      const weeklyRent = tenantRent ? weeklyRentOf(tenantRent.amount, tenantRent.frequency) : undefined;
      const rawExpected =
        agreement.lettingFeeAmount ?? (agreement.lettingFeeWeeksRent && weeklyRent ? agreement.lettingFeeWeeksRent * weeklyRent : undefined);
      results.push(buildResult("Letting Fee", rawExpected !== undefined ? rawExpected * gstMultiplier : undefined, lettingActual, false));
    }
  }

  if (wants("Admin Fee")) {
    const adminActual = actualByType.get("Admin Fee") ?? 0;
    if (adminActual > 0) {
      const expected = agreement.adminFeeAmount !== undefined ? agreement.adminFeeAmount * gstMultiplier : undefined;
      results.push(buildResult("Admin Fee", expected, adminActual, false));
    }
  }

  if (wants("Lease Renewal Fee")) {
    const renewalActual = actualByType.get("Lease Renewal Fee") ?? 0;
    if (renewalActual > 0) {
      const expected = agreement.leaseRenewalFeeAmount !== undefined ? agreement.leaseRenewalFeeAmount * gstMultiplier : undefined;
      results.push(buildResult("Lease Renewal Fee", expected, renewalActual, false));
    }
  }

  if (wants("Inspection Fee")) {
    const inspectionActual = actualByType.get("Inspection Fee") ?? 0;
    if (inspectionActual > 0) {
      const expected = agreement.inspectionFeeAmount !== undefined ? agreement.inspectionFeeAmount * gstMultiplier : undefined;
      results.push(buildResult("Inspection Fee", expected, inspectionActual, false));
    }
  }

  return results;
}

/** Annualizes a flat contracted fee amount using its billing frequency, so it can be compared
 * against a whole FY's worth of actual charges in one go. "Per Statement" is the one frequency
 * that's genuinely per-occurrence, so it scales with however many statements were actually issued
 * in the FY rather than a fixed multiplier. Missing/"Annually" frequency is left as-is (the most
 * common real-world case, and the safest assumption when the frequency wasn't captured). */
function annualizeFlatFee(amount: number, frequency: FeeFrequency | undefined, statementCountInFY: number): number {
  switch (frequency) {
    case "Monthly":
      return amount * 12;
    case "Quarterly":
      return amount * 4;
    case "Per Statement":
      return amount * statementCountInFY;
    case "Annually":
    default:
      return amount;
  }
}

/**
 * Reconciles the three flat/infrequent agreement fees — Admin Fee, Lease Renewal Fee, Inspection
 * Fee — once for a whole FY (or other span), rather than once per calling period. This is the
 * counterpart to verifyAgentFees's per-period Management/Letting Fee handling: those two scale
 * naturally with how often they're charged (a % of rent, a fee per new tenancy), but a flat
 * contracted admin fee doesn't — comparing the same raw contracted amount against every period it
 * recurs in and then summing those "expected" values overstates the true annual figure by however
 * many periods it appeared in. Pass every agent-fee line across the WHOLE span being reconciled in
 * one call (not per month) so `actual` is summed exactly once; `expected` is the frequency-
 * annualized contracted amount. Only emits a result for a fee type that was actually charged
 * somewhere in the span — a renewal/inspection fee never occurring is normal, not a discrepancy,
 * the same asymmetry verifyAgentFees applies to those types.
 */
export function reconcileFlatFees(params: {
  agentName: string;
  agreement: AgreementFeeTerms;
  /** Every agent-fee line across the whole span being reconciled (e.g. a full FY), not per period. */
  lines: FeeLine[];
  /** Count of rent statements actually issued in the span — only used to annualize an Admin Fee
   * with "Per Statement" frequency. */
  statementCount: number;
}): FeeCheckResult[] {
  const { agentName, agreement, lines, statementCount } = params;
  const gstMultiplier = gstMultiplierOf(agreement);
  const actualByType = actualTotalsByType(lines, agentName);
  const results: FeeCheckResult[] = [];

  const adminActual = actualByType.get("Admin Fee") ?? 0;
  if (adminActual > 0) {
    const expected =
      agreement.adminFeeAmount !== undefined
        ? annualizeFlatFee(agreement.adminFeeAmount, agreement.adminFeeFrequency, statementCount) * gstMultiplier
        : undefined;
    results.push(buildResult("Admin Fee", expected, adminActual, false));
  }

  const renewalActual = actualByType.get("Lease Renewal Fee") ?? 0;
  if (renewalActual > 0) {
    const expected = agreement.leaseRenewalFeeAmount !== undefined ? agreement.leaseRenewalFeeAmount * gstMultiplier : undefined;
    results.push(buildResult("Lease Renewal Fee", expected, renewalActual, false));
  }

  const inspectionActual = actualByType.get("Inspection Fee") ?? 0;
  if (inspectionActual > 0) {
    const expected = agreement.inspectionFeeAmount !== undefined ? agreement.inspectionFeeAmount * gstMultiplier : undefined;
    results.push(buildResult("Inspection Fee", expected, inspectionActual, false));
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

/** Whether a ProviderAgreement has recorded enough fee terms to make verification worthwhile at
 * all — used to decide whether to show the fee-check UI in the first place. */
export function hasFeeTerms(agreement: AgreementFeeTerms): boolean {
  return (
    agreement.managementFeePercent !== undefined ||
    agreement.lettingFeeAmount !== undefined ||
    agreement.lettingFeeWeeksRent !== undefined ||
    agreement.adminFeeAmount !== undefined ||
    agreement.leaseRenewalFeeAmount !== undefined ||
    agreement.inspectionFeeAmount !== undefined ||
    agreement.advertisingFeeAmount !== undefined
  );
}
