import { useState } from "react";
import { useStore } from "@/lib/store";
import { fmtCurrency, expenseCategoryToTaxCategory } from "@/lib/calculations";
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import { CompiledFeedTable, type CompiledFeedRow } from "@/components/CompiledFeedTable";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/Field";
import { toast } from "sonner";
import { EXPENSE_CATEGORIES } from "@/lib/types";
import type {
  AiIntakeProposal,
  ExpenseCategory,
  Loan,
  LoanStatementLineItem,
  LoanStatementProposalPayload,
} from "@/lib/types";

type RowKind = "interest" | "principal" | "fee" | "reference";

interface FeedRow {
  proposalId: string;
  originalLineIndex: number;
  kind: RowKind;
  /** i*2 for interest/fee, i*2+1 for principal — two independently-recordable components can
   * come from one statement line, so a plain line index can't identify either on its own. See
   * Expense.feedLineIndex for the encoding note. Undefined for a "reference" row, which is never
   * recordable and so never needs one. */
  feedKey?: number;
  date: string;
  description: string;
  amount: number;
  direction: "debit" | "credit";
  lenderName: string;
  sourceFileName?: string;
  sourceFileData?: string;
  recorded: boolean;
  expenseId?: string;
}

const CATEGORY_BY_KIND: Record<Exclude<RowKind, "reference">, ExpenseCategory> = {
  interest: "Interest on Loan",
  principal: "Loan Principal Repayment",
  fee: "Borrowing Expenses",
};

/** Every proposal that plausibly belongs to this loan's statement history — shared by
 * LoanCompiledFeed and LoanStatementHistory so the two can't silently disagree on what counts.
 * A proposal counts once it's either matched to this loan directly (matchedLoanId, set for a
 * still-pending upload) or has already produced a loan_statements row for this loan (proposalId,
 * from the classic "Apply to loan" flow) — dismissed proposals are excluded either way. */
export function relevantLoanStatementProposals(
  loanId: string,
  proposals: AiIntakeProposal[],
  loanStatements: ReturnType<typeof useStore>["state"]["loanStatements"],
): AiIntakeProposal[] {
  const forThisLoan = loanStatements.filter((s) => s.loanId === loanId);
  return proposals.filter(
    (p) =>
      p.kind === "loan_statement" &&
      p.status !== "dismissed" &&
      (p.matchedLoanId === loanId || forThisLoan.some((s) => s.proposalId === p.id)),
  );
}

/** A proposal predating per-date line_items (or one the statement genuinely gave only one period
 * total for) falls back to a single synthetic line covering the whole period. */
function linesFor(
  payload: LoanStatementProposalPayload,
  proposalCreatedAt?: string,
): LoanStatementLineItem[] {
  if (payload.lineItems && payload.lineItems.length > 0) return payload.lineItems;
  if (
    payload.interestCharged !== undefined ||
    payload.principalPaid !== undefined ||
    payload.repaymentsMade !== undefined
  ) {
    return [
      {
        date: payload.periodEnd || payload.periodStart || proposalCreatedAt?.slice(0, 10) || "",
        interestCharged: payload.interestCharged,
        principalPaid: payload.principalPaid,
        repaymentAmount: payload.repaymentsMade,
        balanceAfter: payload.closingBalance,
      },
    ];
  }
  return [];
}

interface LineComponent {
  kind: RowKind;
  feedKey?: number;
  amount: number;
  direction: "debit" | "credit";
  description: string;
}

/**
 * Splits one printed statement line into its independently-recordable components — never by
 * guessing from the amount or description text, only by which numeric field the AI extraction
 * actually populated for that line. A line can yield an interest row, a principal row, both, or
 * neither.
 *
 * A line that's just the whole EMI bank transfer (only `repaymentAmount` known — no interest/
 * principal breakdown on that line) becomes a "reference" row instead: informational only, never
 * offered up to record. Recording the FULL repayment under a single category (as an earlier
 * version of this component did, defaulting to "Interest on Loan") would overstate the interest
 * deduction, since principal is never deductible — real interest, when a statement itemizes it at
 * all, always shows up as its own separate line with `interestCharged` set, which the branch
 * above already handles correctly. The one exception is a lender-fee line (no interest/principal,
 * but the description says "fee") — that blended figure legitimately maps to one category
 * ("Borrowing Expenses"), so it stays recordable.
 */
function componentsFor(li: LoanStatementLineItem, i: number): LineComponent[] {
  const out: LineComponent[] = [];
  if (li.interestCharged !== undefined) {
    out.push({
      kind: "interest",
      feedKey: i * 2,
      amount: li.interestCharged,
      direction: "debit",
      description: li.description ?? "Interest charged",
    });
  }
  if (li.principalPaid !== undefined) {
    out.push({
      kind: "principal",
      feedKey: i * 2 + 1,
      amount: li.principalPaid,
      direction: "credit",
      description: li.description ?? "Principal payment",
    });
  }
  if (out.length === 0 && li.repaymentAmount !== undefined) {
    if (/fee/i.test(li.description ?? "")) {
      out.push({
        kind: "fee",
        feedKey: i * 2,
        amount: li.repaymentAmount,
        direction: "debit",
        description: li.description ?? "Lender fee",
      });
    } else {
      out.push({
        kind: "reference",
        amount: li.repaymentAmount,
        direction: li.direction === "debit" ? "debit" : "credit",
        description: li.description ?? "Repayment",
      });
    }
  }
  if (out.length === 0) {
    out.push({
      kind: "reference",
      amount: 0,
      direction: li.direction ?? "credit",
      description: li.description ?? "Statement line",
    });
  }
  return out;
}

/** Every line ever extracted from an uploaded/emailed statement for this loan, shown one row per
 * printed-line component — same visual shape as BankFeed's general bank-account feed, but
 * a loan-statement line can split into up to two rows (see componentsFor) since interest and
 * principal are never both safely filed under one category. Reconstructed from
 * ai_intake_proposals rather than a separate feed table: a proposal's payload never changes after
 * upload, so a component with no matching Expense (by feedProposalId + feedKey) is "still in the
 * feed". Recorded status for an "interest" row also checks the older per-period loan_statements
 * record (proposalId + date) so a line already applied via that classic flow isn't offered up to
 * be recorded a second time — that fallback never applies to "principal" rows, since the classic
 * flow never posted principal as an expense in the first place.
 */
function buildFeedRows(
  loan: Loan,
  proposals: AiIntakeProposal[],
  expenses: ReturnType<typeof useStore>["state"]["expenses"],
  loanStatements: ReturnType<typeof useStore>["state"]["loanStatements"],
): FeedRow[] {
  const relevant = relevantLoanStatementProposals(loan.id, proposals, loanStatements);

  const rows: FeedRow[] = [];
  for (const p of relevant) {
    const payload = p.payload as LoanStatementProposalPayload;
    const lines = linesFor(payload, p.created_at);

    lines.forEach((li, i) => {
      for (const c of componentsFor(li, i)) {
        let recorded = false;
        let expenseId: string | undefined;
        if (c.feedKey !== undefined) {
          const match = expenses.find(
            (e) => e.feedProposalId === p.id && e.feedLineIndex === c.feedKey,
          );
          if (match) {
            recorded = true;
            expenseId = match.id;
          } else if (c.kind === "interest") {
            // Checked against ALL loans' statements, not just this one — the same proposal can
            // end up matched to more than one Loan record (e.g. a duplicate loan created by
            // mistake from a second statement upload), and this line must still read as "already
            // recorded" wherever it's viewed from, or it double-posts the same real-world interest
            // charge as a second deductible expense under the other loan.
            recorded = loanStatements.some(
              (s) => s.proposalId === p.id && s.periodStart === li.date && s.periodEnd === li.date,
            );
          }
        }
        rows.push({
          proposalId: p.id,
          originalLineIndex: i,
          kind: c.kind,
          feedKey: c.feedKey,
          date: li.date,
          description: c.description,
          amount: c.amount,
          direction: c.direction,
          lenderName: payload.lenderName,
          sourceFileName: p.sourceFileName,
          sourceFileData: p.sourceFileData,
          recorded,
          expenseId,
        });
      }
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Per-loan "compiled bank feed" — see buildFeedRows above. The category picker isn't shown up
 * front for every row (noisy on a statement with many lines) — "Record" opens a small dialog
 * asking for it just for that one line, pre-filled with the sensible per-kind default. Renders
 * nothing when a loan has never had a statement uploaded/emailed for it. */
export function LoanCompiledFeed({ loan }: { loan: Loan }) {
  const { state, addExpense, deleteExpense, findOrCreateProvider, markProposalApplied } =
    useStore();
  const rows = buildFeedRows(loan, state.aiProposals, state.expenses, state.loanStatements);
  const [recording, setRecording] = useState<FeedRow | null>(null);
  const [category, setCategory] = useState<ExpenseCategory>("Interest on Loan");
  if (rows.length === 0) return null;

  const keyOf = (r: FeedRow) => `${r.proposalId}-${r.originalLineIndex}-${r.kind}`;

  const openRecord = (r: FeedRow) => {
    setRecording(r);
    setCategory(CATEGORY_BY_KIND[r.kind as Exclude<RowKind, "reference">]);
  };

  const confirmRecord = () => {
    if (!recording) return;
    const lenderProviderId = findOrCreateProvider(
      recording.lenderName,
      loan.propertyId,
      "Interest on Loan",
    );
    addExpense({
      itemName: `${recording.lenderName} — ${recording.description}`,
      cost: recording.amount,
      date: recording.date,
      propertyId: loan.propertyId,
      assetId: loan.assetId,
      category,
      taxCategory: expenseCategoryToTaxCategory(category),
      providerName: recording.lenderName,
      providerId: lenderProviderId,
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "upload",
      sourceFileName: recording.sourceFileName,
      sourceFileData: recording.sourceFileData,
      feedProposalId: recording.proposalId,
      feedLineIndex: recording.feedKey,
    });
    markProposalApplied(recording.proposalId, { propertyId: loan.propertyId });
    toast.success("Recorded");
    setRecording(null);
  };

  const unrecord = (r: FeedRow) => {
    if (!r.expenseId) return;
    if (!confirm("Revert this line back to the feed? This deletes the recorded expense.")) return;
    deleteExpense(r.expenseId);
    toast.success("Reverted to feed");
  };

  const recordable = rows.filter((r) => r.kind !== "reference");
  const recordedCount = recordable.filter((r) => r.recorded).length;
  const feedOnlyCount = recordable.length - recordedCount;
  const referenceCount = rows.length - recordable.length;

  const tableRows: CompiledFeedRow[] = rows.map((r) => ({
    key: keyOf(r),
    date: r.date,
    description: r.description,
    amount: r.amount,
    direction: r.direction,
    status: r.kind === "reference" ? "reference" : r.recorded ? "recorded" : "feed_only",
    statusNote:
      r.kind === "reference"
        ? "Whole repayment — interest is recorded on its own line when the statement itemizes it; this line itself isn't posted as an expense."
        : undefined,
    onRecord: r.kind !== "reference" && !r.recorded ? () => openRecord(r) : undefined,
    onUnrecord: r.recorded && r.expenseId ? () => unrecord(r) : undefined,
  }));

  return (
    <CollapsibleGroupSection
      label="Compiled bank feed"
      summary={
        <span>
          {recordedCount} recorded · {feedOnlyCount} feed only · {referenceCount} reference
        </span>
      }
    >
      <div className="p-3">
        <CompiledFeedTable rows={tableRows} includeReferenceFilter />
      </div>

      <Dialog open={!!recording} onOpenChange={(o) => !o && setRecording(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record line</DialogTitle>
          </DialogHeader>
          {recording && (
            <div className="space-y-3 text-sm">
              <div className="rounded border p-2 text-xs text-muted-foreground">
                {recording.date} · {recording.description} ·{" "}
                <span className="font-medium text-foreground">{fmtCurrency(recording.amount)}</span>
              </div>
              <Field label="Category">
                <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecording(null)}>
              Cancel
            </Button>
            <Button onClick={confirmRecord}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollapsibleGroupSection>
  );
}
