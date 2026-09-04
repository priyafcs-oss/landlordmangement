import { useStore } from "@/lib/store";
import { fmtCurrency, expenseCategoryToTaxCategory, todayISO } from "@/lib/calculations";
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  AiIntakeProposal,
  Loan,
  LoanStatementLineItem,
  LoanStatementProposalPayload,
} from "@/lib/types";

interface FeedRow {
  proposalId: string;
  date: string;
  interestCharged?: number;
  principalPaid?: number;
  repaymentAmount?: number;
  balanceAfter?: number;
  lenderName: string;
  sourceFileName?: string;
  sourceFileData?: string;
  recorded: boolean;
  loanStatementId?: string;
  expenseId?: string;
  feeExpenseId?: string;
}

/** Every interest/repayment line ever extracted from an uploaded statement for this loan —
 * whether or not it's been turned into a real record yet — reconstructed from the underlying
 * ai_intake_proposals rather than a separate feed table: a proposal's payload.lineItems never
 * changes after upload, so a line with no matching loan_statements row (by proposalId + date) is
 * simply "still in the feed", and one that does have a match is "recorded". Reverting a recorded
 * line (deleting its loan_statements row) makes it reappear here automatically, with nothing
 * else to reconcile. Scoped to `kind === "loan_statement"` proposals only — a general mixed-
 * category bank account feed is a different, broader concept this doesn't attempt to cover. */
function buildFeedRows(
  loan: Loan,
  proposals: AiIntakeProposal[],
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
                date:
                  payload.periodEnd ||
                  payload.periodStart ||
                  p.created_at?.slice(0, 10) ||
                  todayISO(),
                interestCharged: payload.interestCharged,
                principalPaid: payload.principalPaid,
                repaymentAmount: payload.repaymentsMade,
                balanceAfter: payload.closingBalance,
              },
            ]
          : [];

    for (const li of lines) {
      const match = forThisLoan.find(
        (s) => s.proposalId === p.id && s.periodStart === li.date && s.periodEnd === li.date,
      );
      rows.push({
        proposalId: p.id,
        date: li.date,
        interestCharged: li.interestCharged,
        principalPaid: li.principalPaid,
        repaymentAmount: li.repaymentAmount,
        balanceAfter: li.balanceAfter,
        lenderName: payload.lenderName,
        sourceFileName: p.sourceFileName,
        sourceFileData: p.sourceFileData,
        recorded: !!match,
        loanStatementId: match?.id,
        expenseId: match?.expenseId,
        feeExpenseId: match?.feeExpenseId,
      });
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Per-loan "compiled bank feed" — every line an uploaded statement has ever produced for this
 * loan, each independently created or reverted, rather than the one-shot "review this whole
 * statement now" flow the general Inbox offers. Renders nothing when a loan has never had a
 * statement uploaded for it. */
export function LoanCompiledFeed({ loan }: { loan: Loan }) {
  const {
    state,
    addExpense,
    addLoanStatement,
    updateLoan,
    deleteLoanStatement,
    deleteExpense,
    findOrCreateProvider,
    markProposalApplied,
  } = useStore();
  const rows = buildFeedRows(loan, state.aiProposals, state.loanStatements);
  if (rows.length === 0) return null;

  const create = (row: FeedRow) => {
    const lenderProviderId = findOrCreateProvider(
      row.lenderName,
      loan.propertyId,
      "Interest on Loan",
    );
    const expenseId = row.interestCharged
      ? addExpense({
          itemName: `${row.lenderName} — loan interest`,
          cost: row.interestCharged,
          date: row.date,
          propertyId: loan.propertyId,
          assetId: loan.assetId,
          category: "Interest on Loan",
          taxCategory: expenseCategoryToTaxCategory("Interest on Loan"),
          providerName: row.lenderName,
          providerId: lenderProviderId,
          hasWarranty: false,
          rechargeToTenant: false,
          status: "approved",
          source: "upload",
          sourceFileName: row.sourceFileName,
          sourceFileData: row.sourceFileData,
        })
      : undefined;

    addLoanStatement({
      loanId: loan.id,
      propertyId: loan.propertyId,
      periodStart: row.date,
      periodEnd: row.date,
      interestCharged: row.interestCharged,
      principalPaid: row.principalPaid,
      repaymentsMade: row.repaymentAmount,
      closingBalance: row.balanceAfter,
      sourceFileName: row.sourceFileName,
      sourceFileData: row.sourceFileData,
      proposalId: row.proposalId,
      expenseId,
    });

    if (row.balanceAfter !== undefined) updateLoan(loan.id, { totalBalance: row.balanceAfter });
    // Only flips the proposal's own status flag (harmless if another line from the same
    // statement is created later, or if it was already applied) — never touches the other lines'
    // own recorded/feed-only state, which is derived fresh from loanStatements every render.
    markProposalApplied(row.proposalId, { propertyId: loan.propertyId });
    toast.success("Recorded");
  };

  const unrecord = (row: FeedRow) => {
    if (!row.loanStatementId) return;
    if (!confirm("Revert this entry back to the feed? This deletes the recorded expense(s) too."))
      return;
    deleteLoanStatement(row.loanStatementId);
    if (row.expenseId) deleteExpense(row.expenseId);
    if (row.feeExpenseId) deleteExpense(row.feeExpenseId);
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
        {rows.map((r, i) => (
          <div
            key={`${r.proposalId}-${i}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
          >
            <span className="text-muted-foreground">{r.date}</span>
            <span>
              Interest {r.interestCharged !== undefined ? fmtCurrency(r.interestCharged) : "—"}
            </span>
            <span>
              Principal {r.principalPaid !== undefined ? fmtCurrency(r.principalPaid) : "—"}
            </span>
            <span>
              Repayment {r.repaymentAmount !== undefined ? fmtCurrency(r.repaymentAmount) : "—"}
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
