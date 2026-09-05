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

interface FeedRow {
  proposalId: string;
  lineIndex: number;
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

/** Best-effort description/direction/headline-amount for a line staged before this field existed
 * (or when the statement genuinely had no description column) — keeps an older proposal showing
 * something sensible in the feed instead of going blank, without requiring a re-upload. */
function describeLine(li: LoanStatementLineItem): {
  description: string;
  direction: "debit" | "credit";
  amount: number;
} {
  const amount = li.repaymentAmount ?? li.interestCharged ?? li.principalPaid ?? 0;
  if (li.description && li.direction)
    return { description: li.description, direction: li.direction, amount };
  const direction: "debit" | "credit" =
    li.direction ?? (li.repaymentAmount || li.principalPaid ? "credit" : "debit");
  const description =
    li.description ??
    (li.repaymentAmount
      ? "Repayment"
      : li.interestCharged
        ? "Interest charged"
        : "Principal payment");
  return { description, direction, amount };
}

/** Every line ever extracted from an uploaded/emailed statement for this loan, shown exactly like
 * PropertyBankFeed's general bank-account feed — one row per printed statement line, independently
 * created (with its own picked category) or reverted. Reconstructed from ai_intake_proposals
 * rather than a separate feed table: a proposal's payload never changes after upload, so a line
 * with no matching Expense (by feedProposalId + feedLineIndex) is "still in the feed". This is
 * deliberately a simpler, flatter tool than the structured "Upload → Apply to loan" review card
 * (LoanStatementProposalCard) or the manual entry dialog — both of which still do the finer-
 * grained interest/principal split into two separate records; here, one line becomes one Expense
 * under whichever single category is picked for it, same as a personal bank statement line.
 * Recorded status also checks the older per-period loan_statements record (proposalId + date) so
 * a line already applied via that classic flow isn't offered up to be recorded a second time. */
function buildFeedRows(
  loan: Loan,
  proposals: AiIntakeProposal[],
  expenses: ReturnType<typeof useStore>["state"]["expenses"],
  loanStatements: ReturnType<typeof useStore>["state"]["loanStatements"],
): FeedRow[] {
  const forThisLoan = loanStatements.filter((s) => s.loanId === loan.id);
  const relevant = proposals.filter(
    (p) =>
      p.kind === "loan_statement" &&
      p.status !== "dismissed" &&
      (p.matchedLoanId === loan.id || forThisLoan.some((s) => s.proposalId === p.id)),
  );

  const rows: FeedRow[] = [];
  for (const p of relevant) {
    const payload = p.payload as LoanStatementProposalPayload;
    const lines: LoanStatementLineItem[] =
      payload.lineItems && payload.lineItems.length > 0
        ? payload.lineItems
        : payload.interestCharged !== undefined ||
            payload.principalPaid !== undefined ||
            payload.repaymentsMade !== undefined
          ? [
              {
                date: payload.periodEnd || payload.periodStart || p.created_at?.slice(0, 10) || "",
                interestCharged: payload.interestCharged,
                principalPaid: payload.principalPaid,
                repaymentAmount: payload.repaymentsMade,
                balanceAfter: payload.closingBalance,
              },
            ]
          : [];

    lines.forEach((li, i) => {
      const { description, direction, amount } = describeLine(li);
      const recordedNew = expenses.some((e) => e.feedProposalId === p.id && e.feedLineIndex === i);
      const recordedClassic = forThisLoan.some(
        (s) => s.proposalId === p.id && s.periodStart === li.date && s.periodEnd === li.date,
      );
      const expenseId = expenses.find(
        (e) => e.feedProposalId === p.id && e.feedLineIndex === i,
      )?.id;
      rows.push({
        proposalId: p.id,
        lineIndex: i,
        date: li.date,
        description,
        amount,
        direction,
        lenderName: payload.lenderName,
        sourceFileName: p.sourceFileName,
        sourceFileData: p.sourceFileData,
        recorded: recordedNew || recordedClassic,
        expenseId,
      });
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const defaultCategoryFor = (description: string): ExpenseCategory => {
  const d = description.toLowerCase();
  if (d.includes("fee")) return "Borrowing Expenses";
  if (d.includes("principal") || d.includes("redraw")) return "Loan Principal Repayment";
  return "Interest on Loan";
};

/** Per-loan "compiled bank feed" — see buildFeedRows above. Renders nothing when a loan has never
 * had a statement uploaded/emailed for it. */
export function LoanCompiledFeed({ loan }: { loan: Loan }) {
  const { state, addExpense, deleteExpense, findOrCreateProvider, markProposalApplied } =
    useStore();
  const rows = buildFeedRows(loan, state.aiProposals, state.expenses, state.loanStatements);
  const [categories, setCategories] = useState<Record<string, ExpenseCategory>>({});
  if (rows.length === 0) return null;

  const keyOf = (r: FeedRow) => `${r.proposalId}-${r.lineIndex}`;
  const categoryFor = (r: FeedRow) => categories[keyOf(r)] ?? defaultCategoryFor(r.description);

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
      feedLineIndex: r.lineIndex,
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

  const recordedCount = rows.filter((r) => r.recorded).length;

  return (
    <CollapsibleGroupSection
      label="Compiled bank feed"
      summary={
        <span>
          {recordedCount} recorded · {rows.length - recordedCount} feed only
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
            {r.recorded ? (
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
