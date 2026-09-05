import { useStore } from "@/lib/store";
import { fmtCurrency } from "@/lib/calculations";
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import { DocumentLink } from "@/components/DocumentLink";
import { relevantLoanStatementProposals } from "@/components/LoanCompiledFeed";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { LoanStatementProposalPayload } from "@/lib/types";

/**
 * Per-loan "Statement files" — a plain document list, deliberately simple: which statements have
 * been uploaded/emailed for this loan and what period each covers, plus every manually-recorded
 * entry (Add manual entry) with its own figures. The interest/principal breakdown that used to
 * live here (a chart plus per-period figures) moved to the more detailed, per-line Compiled Bank
 * Feed below this section — showing both would just be the same numbers twice.
 *
 * A manual entry has no source proposal (no PDF, nothing to "view"), so it's listed separately
 * from uploaded statements rather than folded into one shape — it's also the only place a manual
 * entry's own figures are visible/removable after the fact, since it never feeds into
 * LoanCompiledFeed's proposal-derived rows.
 */
export function LoanStatementHistory({ loanId }: { loanId: string }) {
  const { state, deleteLoanStatement, deleteExpense } = useStore();
  const uploaded = relevantLoanStatementProposals(
    loanId,
    state.aiProposals,
    state.loanStatements,
  ).sort((a, b) =>
    ((b.payload as LoanStatementProposalPayload).periodEnd ?? "").localeCompare(
      (a.payload as LoanStatementProposalPayload).periodEnd ?? "",
    ),
  );
  const manualEntries = state.loanStatements
    .filter((s) => s.loanId === loanId && !s.proposalId)
    .sort((a, b) =>
      (a.periodEnd ?? a.appliedAt ?? "").localeCompare(b.periodEnd ?? b.appliedAt ?? ""),
    );

  if (uploaded.length === 0 && manualEntries.length === 0) return null;

  const removeManualEntry = (id: string, expenseId?: string, feeExpenseId?: string) => {
    if (
      !confirm(
        expenseId || feeExpenseId
          ? "Delete this entry and its logged expense(s)?"
          : "Delete this entry?",
      )
    )
      return;
    deleteLoanStatement(id);
    if (expenseId) deleteExpense(expenseId);
    if (feeExpenseId) deleteExpense(feeExpenseId);
    toast.success("Entry removed");
  };

  return (
    <CollapsibleGroupSection
      label="Statement files"
      summary={<span>{uploaded.length + manualEntries.length}</span>}
    >
      <div className="space-y-1 p-3">
        {uploaded.map((p) => {
          const payload = p.payload as LoanStatementProposalPayload;
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">
                {p.sourceFileName || payload.lenderName || "Statement"}
              </span>
              <span className="text-muted-foreground">
                {payload.periodStart || "—"} → {payload.periodEnd || "—"}
              </span>
              {p.sourceFileData && (
                <DocumentLink
                  fileName={p.sourceFileName}
                  fileData={p.sourceFileData}
                  className="inline-flex items-center gap-1 text-primary underline"
                >
                  <FileText className="h-3 w-3 shrink-0" /> View
                </DocumentLink>
              )}
            </div>
          );
        })}
        {manualEntries.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
          >
            <span className="text-muted-foreground">
              {s.description || `${s.periodStart || "—"} → ${s.periodEnd || "—"}`}
            </span>
            <span>
              Interest {s.interestCharged !== undefined ? fmtCurrency(s.interestCharged) : "—"}
            </span>
            <span>
              Principal {s.principalPaid !== undefined ? fmtCurrency(s.principalPaid) : "—"}
            </span>
            {s.eligibleLenderFee !== undefined && (
              <span>Fee {fmtCurrency(s.eligibleLenderFee)}</span>
            )}
            <span>
              Balance {s.closingBalance !== undefined ? fmtCurrency(s.closingBalance) : "—"}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              title="Delete this entry"
              onClick={() => removeManualEntry(s.id, s.expenseId, s.feeExpenseId)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </CollapsibleGroupSection>
  );
}
