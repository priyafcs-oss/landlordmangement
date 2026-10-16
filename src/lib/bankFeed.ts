import {
  findDuplicateLedgerEntry,
  findDuplicateRecord,
  ledgerDuplicateAsMatch,
  type DuplicateMatch,
} from "@/lib/billMatch";
import { suggestFeedLine, type FeedSuggestion } from "@/lib/feedSuggest";
import type { AiIntakeProposal, AppState, BankStatementProposalPayload } from "@/lib/types";

/** One copy of a transaction line on one uploaded statement. */
export interface FeedLineRef {
  proposalId: string;
  lineIndex: number;
}

/**
 * One real-world transaction in a compiled bank feed. Two statements covering overlapping periods
 * both list the transactions in the overlap; those copies are collapsed into one row here, so the
 * line only shows (and can only be recorded) once. `proposalId`/`lineIndex` is the copy a new
 * recording is linked to — the already-recorded copy when there is one.
 */
export interface FeedRow extends FeedLineRef {
  /** Every statement line this row stands for (length > 1 = it appeared on overlapping statements). */
  copies: FeedLineRef[];
  date: string;
  description: string;
  amount: number;
  direction: "in" | "out";
  providerId?: string;
  suggestedProviderName?: string;
  suggestedPropertyId?: string;
  sourceFileName?: string;
  sourceFileData?: string;
  recorded: boolean;
  /** How many of the copies were each recorded separately — more than 1 means the transaction is
   * on the books twice (recorded from both statements before this dedupe existed). */
  recordedCount: number;
  expenseId?: string;
  /** Set instead of expenseId when the line was recorded as a tenant's rent payment. */
  ledgerEntryId?: string;
}

type FeedState = Pick<AppState, "expenses" | "ledger">;

/**
 * Compiles every line of the given bank statements into one feed. Copies of the same transaction
 * from overlapping statements share a key of account + date + direction + amount — deliberately not
 * the description, which the AI extraction can word differently on two PDFs of the same line. Two
 * genuinely separate identical transactions on ONE statement stay separate: the n-th copy on each
 * statement is collapsed only with the n-th copy on the others, so a key keeps as many rows as the
 * statement listing it most often.
 */
export function buildFeedRows(proposals: AiIntakeProposal[], state: FeedState): FeedRow[] {
  const slots = new Map<string, (FeedLineRef & { p: AiIntakeProposal })[]>();
  for (const p of proposals) {
    const payload = p.payload as BankStatementProposalPayload;
    const account = p.bankAccountId || payload.accountNumber || "";
    const seen = new Map<string, number>();
    payload.transactions.forEach((tx, i) => {
      const base = `${account}|${tx.date}|${tx.direction}|${Math.round(tx.amount * 100)}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const slotKey = `${base}#${n}`;
      const list = slots.get(slotKey) ?? [];
      list.push({ proposalId: p.id, lineIndex: i, p });
      slots.set(slotKey, list);
    });
  }

  const rows: FeedRow[] = [];
  for (const copies of slots.values()) {
    const recordedCopies = copies
      .map((c) => ({
        c,
        expense: state.expenses.find(
          (e) => e.feedProposalId === c.proposalId && e.feedLineIndex === c.lineIndex,
        ),
        ledger: state.ledger.find(
          (e) => e.feedProposalId === c.proposalId && e.feedLineIndex === c.lineIndex,
        ),
      }))
      .filter((r) => r.expense || r.ledger);
    const primary = recordedCopies[0]?.c ?? copies[0];
    const tx = (primary.p.payload as BankStatementProposalPayload).transactions[primary.lineIndex];
    rows.push({
      proposalId: primary.proposalId,
      lineIndex: primary.lineIndex,
      copies: copies.map(({ proposalId, lineIndex }) => ({ proposalId, lineIndex })),
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      direction: tx.direction,
      providerId: tx.providerId,
      suggestedProviderName: tx.suggestedProviderName,
      // Only a statement NOT filed to a bank account carries a property for its lines: an everyday
      // account pays for several properties, and a property stamped on its statement (by the first
      // line recorded from it) made every later line — expenses included — default to that one.
      suggestedPropertyId: copies.find((c) => !c.p.bankAccountId && c.p.propertyId)?.p.propertyId,
      sourceFileName: primary.p.sourceFileName,
      sourceFileData: primary.p.sourceFileData,
      recorded: recordedCopies.length > 0,
      recordedCount: recordedCopies.length,
      expenseId: recordedCopies[0]?.expense?.id,
      ledgerEntryId: recordedCopies[0]?.expense ? undefined : recordedCopies[0]?.ledger?.id,
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface FeedRowAnnotation {
  suggestion: FeedSuggestion | null;
  /** Something already on the books that looks like this same transaction — recorded some other
   * way (an agent statement, Post Payment, Add Transaction), so it isn't linked to this line. */
  existing: DuplicateMatch | null;
}

type AnnotateState = Pick<
  AppState,
  "tenants" | "providers" | "providerProperties" | "ledger" | "bills" | "expenses"
>;

/** Suggestion + already-on-the-books check for one unrecorded feed row. */
export function annotateFeedRow(row: FeedRow, state: AnnotateState): FeedRowAnnotation {
  const suggestion = suggestFeedLine(
    {
      date: row.date,
      description: row.description,
      amount: row.amount,
      direction: row.direction,
      providerId: row.providerId,
      propertyId: row.suggestedPropertyId,
    },
    state,
  );
  // Paying an unpaid bill is the point of a "bill" suggestion — the duplicate check would just
  // find that same bill and flag it.
  if (suggestion?.kind === "bill") return { suggestion, existing: null };
  return {
    suggestion,
    existing: existingRecordFor(
      row,
      suggestion?.tenantId,
      suggestion?.propertyId ?? row.suggestedPropertyId,
      state,
    ),
  };
}

/** A flagged line that's safe to record in one click: a suggestion with a known property, and
 * nothing already on the books for it. */
export function isAcceptable(a: FeedRowAnnotation & { row: FeedRow }): boolean {
  // A plain expense always goes through the Record dialog so the landlord picks its property —
  // only rent (the tenant fixes the property) and a bill payment (the bill does) are one-click.
  return !a.row.recorded && a.suggestion?.kind !== "expense" && !!a.suggestion?.propertyId && !a.existing;
}

/** The duplicate check recording this line would trip: a matching rent payment on the tenant's
 * ledger when it's going there, otherwise a matching Bill/Expense. */
export function existingRecordFor(
  row: Pick<FeedRow, "date" | "description" | "amount">,
  tenantId: string | undefined,
  propertyId: string | undefined,
  state: Pick<AppState, "ledger" | "bills" | "expenses">,
): DuplicateMatch | null {
  if (tenantId) {
    const dup = findDuplicateLedgerEntry(state.ledger, {
      tenantId,
      amount: row.amount,
      date: row.date,
    });
    return dup ? ledgerDuplicateAsMatch(dup) : null;
  }
  return findDuplicateRecord(state.bills, state.expenses, {
    propertyId,
    vendorOrDescription: row.description,
    amount: row.amount,
    date: row.date,
  });
}

/** Rows of the feed that include a line from this statement. */
export function rowsForStatement(rows: FeedRow[], proposalId: string): FeedRow[] {
  return rows.filter((r) => r.copies.some((c) => c.proposalId === proposalId));
}

/** Every non-dismissed statement filed against the same account as `proposal` (itself included) —
 * the set its lines are deduplicated against. */
export function sameAccountStatements(
  proposal: AiIntakeProposal,
  proposals: AiIntakeProposal[],
): AiIntakeProposal[] {
  return proposals.filter(
    (p) =>
      p.kind === "bank_statement" &&
      p.status !== "dismissed" &&
      (p.id === proposal.id ||
        (!!proposal.bankAccountId && p.bankAccountId === proposal.bankAccountId)),
  );
}

export interface StatementSummary {
  total: number;
  /** Not yet recorded (from this statement or any overlapping one). */
  newCount: number;
  /** Of those, how many have a rent suggestion with nothing already on the ledger for it. */
  rentSuggestions: number;
  /** Of those, debits that look like a property expense or pay an unpaid bill. */
  expenseFlags: number;
}

/** What a newly uploaded bank statement adds to its account's feed — for the compact notice. */
export function summarizeStatement(
  proposal: AiIntakeProposal,
  state: AnnotateState & Pick<AppState, "aiProposals">,
): StatementSummary {
  const rows = rowsForStatement(
    buildFeedRows(sameAccountStatements(proposal, state.aiProposals), state),
    proposal.id,
  );
  const open = rows.filter((r) => !r.recorded);
  const annotated = open.map((r) => annotateFeedRow(r, state));
  const rentSuggestions = annotated.filter(
    (a) => a.suggestion?.kind === "rent" && !a.existing,
  ).length;
  const expenseFlags = annotated.filter(
    (a) => a.suggestion && a.suggestion.kind !== "rent" && !a.existing,
  ).length;
  return { total: rows.length, newCount: open.length, rentSuggestions, expenseFlags };
}

export interface FeedTotals {
  /** Money in (credit lines). */
  totalIn: number;
  /** Money out (debit lines). */
  totalOut: number;
  net: number;
}

/** In/out/net over compiled-feed rows (CompiledFeedTable's month subtotals) — "reference" lines (informational loan EMI lines) aren't money
 * movements of their own, so they're left out. */
export function feedTotals(
  rows: { amount: number; direction: "debit" | "credit"; status: string }[],
): FeedTotals {
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    if (r.status === "reference") continue;
    if (r.direction === "credit") totalIn += r.amount;
    else totalOut += r.amount;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { totalIn: round(totalIn), totalOut: round(totalOut), net: round(totalIn - totalOut) };
}
