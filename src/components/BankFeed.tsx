import { useState } from "react";
import { useStore } from "@/lib/store";
import { fmtCurrency, expenseCategoryToTaxCategory } from "@/lib/calculations";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  /** The proposal's own propertyId, when the AI matched one — only ever a starting suggestion in
   * the Record dialog, never forced: an everyday bank account isn't tied to one property, and a
   * single statement can carry transactions for several. */
  suggestedPropertyId?: string;
  sourceFileName?: string;
  sourceFileData?: string;
  recorded: boolean;
  expenseId?: string;
}

/** Every transaction ever extracted from a general (non-loan) bank statement, across the whole
 * portfolio — not scoped to a single property, since the account itself isn't. Reconstructed from
 * ai_intake_proposals (kind "bank_statement") the same way LoanCompiledFeed reconstructs its rows,
 * matched against state.expenses by feedProposalId/feedLineIndex to tell "already recorded" apart
 * from "still feed only". */
function buildFeedRows(
  proposals: AiIntakeProposal[],
  expenses: ReturnType<typeof useStore>["state"]["expenses"],
): FeedRow[] {
  const relevant = proposals.filter((p) => p.kind === "bank_statement" && p.status !== "dismissed");
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
        suggestedPropertyId: p.propertyId,
        sourceFileName: p.sourceFileName,
        sourceFileData: p.sourceFileData,
        recorded: !!match,
        expenseId: match?.id,
      });
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Portfolio-wide "Bank Feed" — a plain list by default (date, amount, description, Recorded/Feed
 * only) with no category or property picker shown up front; both are only asked for once you
 * actually hit "Record" on a specific line, via the dialog below. Keeps the list scannable even
 * with a long statement, and matches the same pattern used for LoanCompiledFeed. */
export function BankFeedContent() {
  const { state, addExpense, deleteExpense, markProposalApplied } = useStore();
  const rows = buildFeedRows(state.aiProposals, state.expenses);
  const [recording, setRecording] = useState<FeedRow | null>(null);
  const [category, setCategory] = useState<string>("");
  const [propertyId, setPropertyId] = useState("");

  const openRecord = (r: FeedRow) => {
    setRecording(r);
    const provider = r.providerId ? state.providers.find((p) => p.id === r.providerId) : undefined;
    setCategory(
      provider?.defaultCategory ??
        (r.direction === "in" ? "Other Rental Income" : "Sundry Rental Expenses"),
    );
    setPropertyId(r.suggestedPropertyId ?? "");
  };

  const confirmRecord = () => {
    if (!recording) return;
    if (!propertyId) return toast.error("Select which property this belongs to");
    addExpense({
      itemName: recording.description,
      cost: recording.amount,
      date: recording.date,
      propertyId,
      direction: recording.direction === "in" ? "Income" : undefined,
      category: category as ExpenseCategory,
      taxCategory:
        recording.direction === "out"
          ? expenseCategoryToTaxCategory(category)
          : "Immediate Deduction",
      providerId: recording.providerId,
      providerName: recording.suggestedProviderName,
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "upload",
      sourceFileName: recording.sourceFileName,
      sourceFileData: recording.sourceFileData,
      feedProposalId: recording.proposalId,
      feedLineIndex: recording.lineIndex,
    });
    markProposalApplied(recording.proposalId, { propertyId });
    toast.success("Recorded");
    setRecording(null);
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
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-sm font-medium">Bank Feed</div>
        <div className="text-xs text-muted-foreground">
          Every transaction from an uploaded or emailed bank statement, across the whole portfolio —
          an everyday account isn't tied to one property, so entries here can be recorded against
          whichever property they actually belong to.
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-xs text-muted-foreground">
            No bank statement uploaded yet — upload one from a property's Bills tab, or forward it
            by email.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            {recordedCount} recorded · {rows.length - recordedCount} feed only
          </div>
          {rows.map((r) => (
            <div
              key={`${r.proposalId}-${r.lineIndex}`}
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
                  <Badge variant="outline">Feed only</Badge>
                  <Button size="sm" className="h-6 text-xs" onClick={() => openRecord(r)}>
                    Record
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!recording} onOpenChange={(o) => !o && setRecording(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record transaction</DialogTitle>
          </DialogHeader>
          {recording && (
            <div className="space-y-3 text-sm">
              <div className="rounded border p-2 text-xs text-muted-foreground">
                {recording.date} · {recording.description} ·{" "}
                <span className="font-medium text-foreground">{fmtCurrency(recording.amount)}</span>
              </div>
              <Field label="Property">
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.properties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.alias || p.address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Category">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(recording.direction === "in" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(
                      (c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ),
                    )}
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
    </div>
  );
}
