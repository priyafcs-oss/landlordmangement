import type { Expense, LedgerEntry, PropertyBill } from "./types";

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

export interface DuplicateMatch {
  kind: "bill" | "expense";
  id: string;
  label: string;
  amount: number;
  date: string;
  status?: string;
  sourceFileName?: string;
  sourceFileData?: string;
}

export interface DuplicateCandidate {
  propertyId?: string;
  vendorOrDescription: string;
  amount: number;
  date: string;
  referenceNumber?: string;
  bpayReference?: string;
}

const DUPLICATE_WINDOW_DAYS = 14;

function symmetricDateWithinWindow(a: string, b: string, days: number): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= days * DAY_MS;
}

function referenceMatches(a?: string, b?: string): boolean {
  return !!a && !!b && a.trim() === b.trim();
}

/**
 * Checks whether a bill/transaction about to be manually saved (Add Bill or Add Transaction —
 * the two paths with no server-side guardrail of any kind) already exists as a Bill or an
 * Expense — same idea as the email/upload pipeline's runGuardrails duplicate check, just running
 * client-side at the point of saving instead of server-side at intake. A match is either a close
 * vendor+amount+date fit, or a reference/BPAY match that ALSO has either the amount or the date
 * roughly agreeing. Reference/BPAY alone isn't enough — most Australian utility "reference
 * numbers" are the ACCOUNT number, not an invoice number, so it's identical on every quarterly (or
 * monthly) bill from the same provider; treating a bare reference match as a duplicate regardless
 * of date or amount flagged every new period's genuine bill against the previous one. Requiring
 * amount-or-date proximity too still catches the real case this was for (the same invoice
 * forwarded/uploaded twice, where amount and date are unchanged) without misfiring on a new bill
 * that just happens to share the account's unchanging reference number. Always a confirmable
 * warning, never a hard block — "Save Anyway" is always available.
 */
export function findDuplicateRecord(
  bills: PropertyBill[],
  expenses: Expense[],
  candidate: DuplicateCandidate,
): DuplicateMatch | null {
  const referenceAndProximityMatch = (
    refA?: string,
    refB?: string,
    bpayA?: string,
    bpayB?: string,
    amountA?: number,
    amountB?: number,
    dateA?: string,
    dateB?: string,
  ): boolean =>
    (referenceMatches(refA, refB) || referenceMatches(bpayA, bpayB)) &&
    !!amountA &&
    !!amountB &&
    !!dateA &&
    !!dateB &&
    (amountMatches(amountA, amountB) || symmetricDateWithinWindow(dateA, dateB, DUPLICATE_WINDOW_DAYS));

  const billMatch = bills.find(
    (b) =>
      (!candidate.propertyId || b.propertyId === candidate.propertyId) &&
      ((vendorMatches(b.providerName, candidate.vendorOrDescription) &&
        amountMatches(b.amount, candidate.amount) &&
        symmetricDateWithinWindow(b.dueDate, candidate.date, DUPLICATE_WINDOW_DAYS)) ||
        referenceAndProximityMatch(
          candidate.referenceNumber,
          b.referenceNumber,
          candidate.bpayReference,
          b.bpayReference,
          candidate.amount,
          b.amount,
          candidate.date,
          b.dueDate,
        )),
  );
  if (billMatch) {
    return {
      kind: "bill",
      id: billMatch.id,
      label: billMatch.providerName || billMatch.billType,
      amount: billMatch.amount,
      date: billMatch.dueDate,
      status: billMatch.status,
      sourceFileName: billMatch.sourceFileName,
      sourceFileData: billMatch.sourceFileData,
    };
  }

  const expenseMatch = expenses.find(
    (e) =>
      (!candidate.propertyId || e.propertyId === candidate.propertyId) &&
      ((vendorMatches(e.itemName, candidate.vendorOrDescription) &&
        amountMatches(e.cost, candidate.amount) &&
        symmetricDateWithinWindow(e.date, candidate.date, DUPLICATE_WINDOW_DAYS)) ||
        referenceAndProximityMatch(
          candidate.referenceNumber,
          e.referenceNumber,
          candidate.bpayReference,
          e.bpayReference,
          candidate.amount,
          e.cost,
          candidate.date,
          e.date,
        )),
  );
  if (expenseMatch) {
    return {
      kind: "expense",
      id: expenseMatch.id,
      label: expenseMatch.itemName,
      amount: expenseMatch.cost,
      date: expenseMatch.date,
      status: expenseMatch.status,
      sourceFileName: expenseMatch.invoiceFileName,
      sourceFileData: expenseMatch.invoiceFileData,
    };
  }

  return null;
}

export interface LedgerDuplicateCandidate {
  tenantId: string;
  amount: number;
  date: string;
}

const LEDGER_DUPLICATE_WINDOW_DAYS = 3;

/**
 * Checks a rent-statement payment line about to be posted to a tenant's ledger against rows
 * already there — the rent-statement review/approval flow (RentLedgerProposalCard) has no
 * server-side guardrail and, unlike Add Bill/Add Transaction, previously had no duplicate check
 * at all, so re-approving the same statement (or two overlapping statements) silently doubled up
 * rent payments. Same tenant + matching amount (±2%) + date within a few days is treated as the
 * same real-world payment; tighter than the bill/expense window since rent payments recur weekly.
 */
export function findDuplicateLedgerEntry(
  ledger: LedgerEntry[],
  candidate: LedgerDuplicateCandidate,
): LedgerEntry | null {
  return (
    ledger.find(
      (e) =>
        e.tenantId === candidate.tenantId &&
        e.type === "Rent Payment" &&
        amountMatches(e.credit, candidate.amount) &&
        symmetricDateWithinWindow(e.date, candidate.date, LEDGER_DUPLICATE_WINDOW_DAYS),
    ) ?? null
  );
}
