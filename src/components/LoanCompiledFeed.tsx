import { useState } from "react";
import { useStore } from "@/lib/store";
import { fmtCurrency, expenseCategoryToTaxCategory } from "@/lib/calculations";
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
 * printed-line component — same visual shape as PropertyBankFeed's general bank-account feed, but
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
  const forThisLoan = loanStatements.filter((s) => s.loanId === loan.id);
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
            recorded = forThisLoan.some(
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

/** Per-loan "compiled bank feed" — see buildFeedRows above. Renders nothing when a loan has never
 * had a statement uploaded/emailed for it. */
export function LoanCompiledFeed({ loan }: { loan: Loan }) {
  const { state, addExpense, deleteExpense, findOrCreateProvider, markProposalApplied } =
    useStore();
  const rows = buildFeedRows(loan, state.aiProposals, state.expenses, state.loanStatements);
  const [categories, setCategories] = useState<Record<string, ExpenseCategory>>({});
  if (rows.length === 0) return null;

  const keyOf = (r: FeedRow) => `${r.proposalId}-${r.originalLineIndex}-${r.kind}`;
  const categoryFor = (r: FeedRow) =>
    categories[keyOf(r)] ?? CATEGORY_BY_KIND[r.kind as Exclude<RowKind, "reference">];

  const create = (r: FeedRow) => {
    const category = categoryFor(r);
    const lenderProviderId = findOrCreateProvider(
      r.lenderName,
      loan.propertyId,
      "Interest on Loan",
    );
    addExpense({
      itemName: `${r.lenderName} — ${r.description}`,
      cost: r.amount,
      date: r.date,
      propertyId: loan.propertyId,
      assetId: loan.assetId,
      category,
      taxCategory: expenseCategoryToTaxCategory(category),
      providerName: r.lenderName,
      providerId: lenderProviderId,
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "upload",
      sourceFileName: r.sourceFileName,
      sourceFileData: r.sourceFileData,
      feedProposalId: r.proposalId,
      feedLineIndex: r.feedKey,
    });
    markProposalApplied(r.proposalId, { propertyId: loan.propertyId });
    toast.success("Recorded");
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

  return (
    <CollapsibleGroupSection
      label="Compiled bank feed"
      summary={
        <span>
          {recordedCount} recorded · {feedOnlyCount} feed only · {referenceCount} reference
        </span>
      }
    >
      <div className="space-y-1 p-3">
        {rows.map((r) => (
          <div
            key={keyOf(r)}
            className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs"
          >
            <span className="w-24 shrink-0 text-muted-foreground">{r.date}</span>
            <span
              className={
                "w-20 shrink-0 text-right font-medium " +
                (r.direction === "credit" ? "text-emerald-600" : "")
              }
            >
              {r.direction === "credit" ? "+" : "−"}
              {fmtCurrency(r.amount)}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.description}>
              {r.description}
            </span>
            {r.kind === "reference" ? (
              <Badge
                variant="outline"
                className="border-dashed text-muted-foreground"
                title="Whole repayment — interest is recorded on its own line when the statement itemizes it; this line itself isn't posted as an expense."
              >
                Reference only
              </Badge>
            ) : r.recorded ? (
              <>
                <Badge variant="secondary">Recorded</Badge>
                {r.expenseId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    onClick={() => unrecord(r)}
                  >
                    Unrecord
                  </Button>
                )}
              </>
            ) : (
              <>
                <Select
                  value={categoryFor(r)}
                  onValueChange={(v) =>
                    setCategories((c) => ({ ...c, [keyOf(r)]: v as ExpenseCategory }))
                  }
                >
                  <SelectTrigger className="h-6 w-[190px] text-xs">
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
                <Badge variant="outline">Feed only</Badge>
                <Button size="sm" className="h-6 text-xs" onClick={() => create(r)}>
                  Create
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </CollapsibleGroupSection>
  );
}
