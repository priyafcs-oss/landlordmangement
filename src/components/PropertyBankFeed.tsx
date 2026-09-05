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
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/types";
import type { AiIntakeProposal, BankStatementProposalPayload, ExpenseCategory } from "@/lib/types";

interface FeedRow {
  proposalId: string;
  lineIndex: number;
  date: string;
  description: string;
  amount: number;
  direction: "in" | "out";
  providerId?: string;
  suggestedProviderName?: string;
  sourceFileName?: string;
  sourceFileData?: string;
  recorded: boolean;
  expenseId?: string;
}

/** Every transaction ever extracted from a general bank statement uploaded for this property —
 * same idea as LoanCompiledFeed, but for `bank_statement` proposals rather than `loan_statement`
 * ones, and matched against `state.expenses` by `feedProposalId`/`feedLineIndex` instead of
 * `loan_statements.proposalId`, since a bank-feed transaction becomes an Expense directly. A line
 * matched to an existing unpaid Bill and paid via BankStatementProposalCard's "mark bill paid"
 * path isn't tracked here — that Bill already has its own paid/unpaid state to revert from. */
function buildFeedRows(
  propertyId: string,
  proposals: AiIntakeProposal[],
  expenses: ReturnType<typeof useStore>["state"]["expenses"],
): FeedRow[] {
  const relevant = proposals.filter(
    (p) => p.kind === "bank_statement" && p.status !== "dismissed" && p.propertyId === propertyId,
  );
  const rows: FeedRow[] = [];
  for (const p of relevant) {
    const payload = p.payload as BankStatementProposalPayload;
    payload.transactions.forEach((tx, i) => {
      const match = expenses.find((e) => e.feedProposalId === p.id && e.feedLineIndex === i);
      rows.push({
        proposalId: p.id,
        lineIndex: i,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        direction: tx.direction,
        providerId: tx.providerId,
        suggestedProviderName: tx.suggestedProviderName,
        sourceFileName: p.sourceFileName,
        sourceFileData: p.sourceFileData,
        recorded: !!match,
        expenseId: match?.id,
      });
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Per-property "compiled bank feed" for general (non-loan) bank statement uploads — renders
 * nothing until a bank statement has actually been uploaded for this property. */
export function PropertyBankFeed({ propertyId }: { propertyId: string }) {
  const { state, addExpense, deleteExpense, markProposalApplied } = useStore();
  const rows = buildFeedRows(propertyId, state.aiProposals, state.expenses);
  const [categories, setCategories] = useState<Record<string, string>>({});
  if (rows.length === 0) return null;

  const keyOf = (r: FeedRow) => `${r.proposalId}-${r.lineIndex}`;
  const categoryFor = (r: FeedRow) =>
    categories[keyOf(r)] ??
    (r.direction === "in" ? "Other Rental Income" : "Sundry Rental Expenses");

  const create = (r: FeedRow) => {
    const category = categoryFor(r);
    addExpense({
      itemName: r.description,
      cost: r.amount,
      date: r.date,
      propertyId,
      direction: r.direction === "in" ? "Income" : undefined,
      category: category as ExpenseCategory,
      taxCategory:
        r.direction === "out" ? expenseCategoryToTaxCategory(category) : "Immediate Deduction",
      providerId: r.providerId,
      providerName: r.suggestedProviderName,
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "upload",
      sourceFileName: r.sourceFileName,
      sourceFileData: r.sourceFileData,
      feedProposalId: r.proposalId,
      feedLineIndex: r.lineIndex,
    });
    markProposalApplied(r.proposalId, { propertyId });
    toast.success("Recorded");
  };

  const unrecord = (r: FeedRow) => {
    if (!r.expenseId) return;
    if (!confirm("Revert this transaction back to the feed? This deletes the recorded expense."))
      return;
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
                (r.direction === "in" ? "text-emerald-600" : "")
              }
            >
              {r.direction === "in" ? "+" : "−"}
              {fmtCurrency(r.amount)}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.description}>
              {r.description}
            </span>
            {r.recorded ? (
              <>
                <Badge variant="secondary">Recorded</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={() => unrecord(r)}
                >
                  Unrecord
                </Button>
              </>
            ) : (
              <>
                <Select
                  value={categoryFor(r)}
                  onValueChange={(v) => setCategories((c) => ({ ...c, [keyOf(r)]: v }))}
                >
                  <SelectTrigger className="h-6 w-[180px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(r.direction === "in" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
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
