import type { PropertyBill } from "./types";

export interface BillMatchCandidate {
  propertyId?: string;
  /** The payee/vendor name (rent-statement expenseLine) or bare description (bank-statement
   * line) that identifies who was paid — matched fuzzily against a bill's providerName. */
  vendorOrDescription: string;
  amount: number;
  /** The date this payment evidence reports — a statement line date or bank-transaction date,
   * not necessarily the bill's own due date. */
  date: string;
}

const DAY_MS = 86_400_000;
const DUE_DATE_LOOKBACK_DAYS = 7;
const DUE_DATE_LOOKAHEAD_DAYS = 60;

function vendorMatches(providerName: string | undefined, candidate: string): boolean {
  if (!providerName) return false;
  const a = providerName.trim().toLowerCase();
  const b = candidate.trim().toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function amountMatches(billAmount: number, candidateAmount: number): boolean {
  const tolerance = Math.max(2, billAmount * 0.02);
  return Math.abs(billAmount - candidateAmount) <= tolerance;
}

function dateWithinWindow(dueDate: string, candidateDate: string): boolean {
  const due = new Date(dueDate).getTime();
  const candidate = new Date(candidateDate).getTime();
  return candidate >= due - DUE_DATE_LOOKBACK_DAYS * DAY_MS && candidate <= due + DUE_DATE_LOOKAHEAD_DAYS * DAY_MS;
}

/**
 * Suggests an existing Unpaid bill that a piece of payment evidence (a rent/agent statement's
 * expense line, or an "out" transaction from a Universal-Upload bank statement) might actually be
 * paying — so it can be surfaced as "mark this bill paid?" instead of silently creating a second,
 * disconnected Expense for the same real-world payment. Always a suggestion the landlord confirms;
 * never auto-applied. `propertyId` + vendor-substring match is the real anti-false-positive
 * control — the amount tolerance and date window just confirm the candidate is plausible.
 */
export function findMatchingUnpaidBill(bills: PropertyBill[], candidate: BillMatchCandidate): PropertyBill | null {
  const scoped = bills.filter(
    (b) =>
      b.status === "Unpaid" &&
      (!candidate.propertyId || b.propertyId === candidate.propertyId) &&
      vendorMatches(b.providerName, candidate.vendorOrDescription) &&
      amountMatches(b.amount, candidate.amount) &&
      dateWithinWindow(b.dueDate, candidate.date),
  );
  if (scoped.length === 0) return null;

  const candidateTime = new Date(candidate.date).getTime();
  return scoped.reduce((best, b) => {
    const bestDelta = Math.abs(new Date(best.dueDate).getTime() - candidateTime);
    const bDelta = Math.abs(new Date(b.dueDate).getTime() - candidateTime);
    if (bDelta < bestDelta) return b;
    if (bDelta > bestDelta) return best;
    // Tie-break on closer amount.
    return Math.abs(b.amount - candidate.amount) < Math.abs(best.amount - candidate.amount) ? b : best;
  });
}
