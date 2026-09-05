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
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import { DocumentLink } from "@/components/DocumentLink";
import { AddBankAccountDialog } from "@/components/AddBankAccountDialog";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import { FileUp, FileText, Pencil } from "lucide-react";
import { toast } from "sonner";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/types";
import type {
  AiIntakeProposal,
  BankAccount,
  BankStatementProposalPayload,
  ExpenseCategory,
} from "@/lib/types";

interface FeedRow {
  proposalId: string;
  lineIndex: number;
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
  expenseId?: string;
}

function buildFeedRows(
  proposals: AiIntakeProposal[],
  expenses: ReturnType<typeof useStore>["state"]["expenses"],
): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const p of proposals) {
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

/** The record-transaction dialog is identical for a specific account's feed and the unassigned
 * bucket below — factored out once rather than duplicated between BankAccountFeed and
 * UnassignedBankFeed. */
function RecordTransactionDialog({
  recording,
  onClose,
  onRecord,
}: {
  recording: FeedRow | null;
  onClose: () => void;
  onRecord: (row: FeedRow, propertyId: string, category: string) => void;
}) {
  const { state } = useStore();
  const [category, setCategory] = useState<string>("");
  const [propertyId, setPropertyId] = useState("");

  // Re-seed whenever a different row opens — a stale category/property from the previous row
  // must never carry over into this one.
  if (recording && category === "" && propertyId === "") {
    const provider = recording.providerId
      ? state.providers.find((p) => p.id === recording.providerId)
      : undefined;
    setCategory(
      provider?.defaultCategory ??
        (recording.direction === "in" ? "Other Rental Income" : "Sundry Rental Expenses"),
    );
    setPropertyId(recording.suggestedPropertyId ?? "");
  }

  const close = () => {
    setCategory("");
    setPropertyId("");
    onClose();
  };

  return (
    <Dialog
      open={!!recording}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
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
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!recording) return;
              if (!propertyId) return toast.error("Select which property this belongs to");
              onRecord(recording, propertyId, category);
              close();
            }}
          >
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FeedRowList({
  rows,
  onRecord,
  onUnrecord,
}: {
  rows: FeedRow[];
  onRecord: (r: FeedRow) => void;
  onUnrecord: (r: FeedRow) => void;
}) {
  const recordedCount = rows.filter((r) => r.recorded).length;
  return (
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
                  onClick={() => onUnrecord(r)}
                >
                  Unrecord
                </Button>
              )}
            </>
          ) : (
            <>
              <Badge variant="outline">Feed only</Badge>
              <Button size="sm" className="h-6 text-xs" onClick={() => onRecord(r)}>
                Record
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function relevantBankStatementProposals(
  proposals: AiIntakeProposal[],
  predicate: (p: AiIntakeProposal) => boolean,
): AiIntakeProposal[] {
  return proposals.filter(
    (p) => p.kind === "bank_statement" && p.status !== "dismissed" && predicate(p),
  );
}

/** One bank account's own uploaded/emailed statements — file name, period, View. */
function BankAccountStatementFiles({ account }: { account: BankAccount }) {
  const { state } = useStore();
  const proposals = relevantBankStatementProposals(
    state.aiProposals,
    (p) => p.bankAccountId === account.id,
  );
  if (proposals.length === 0) return null;

  return (
    <CollapsibleGroupSection label="Statement files" summary={<span>{proposals.length}</span>}>
      <div className="space-y-1 p-3">
        {proposals.map((p) => {
          const payload = p.payload as BankStatementProposalPayload;
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">
                {p.sourceFileName || payload.bankName || "Statement"}
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
      </div>
    </CollapsibleGroupSection>
  );
}

/** One bank account's own compiled bank feed — every transaction from statements uploaded to
 * this exact account, independently recordable against whichever property it actually belongs
 * to (an everyday account routinely pays bills for more than one property). */
function BankAccountFeed({ account }: { account: BankAccount }) {
  const { state, addExpense, deleteExpense, markProposalApplied } = useStore();
  const proposals = relevantBankStatementProposals(
    state.aiProposals,
    (p) => p.bankAccountId === account.id,
  );
  const rows = buildFeedRows(proposals, state.expenses);
  const [recording, setRecording] = useState<FeedRow | null>(null);
  if (rows.length === 0) return null;

  const record = (row: FeedRow, propertyId: string, category: string) => {
    addExpense({
      itemName: row.description,
      cost: row.amount,
      date: row.date,
      propertyId,
      direction: row.direction === "in" ? "Income" : undefined,
      category: category as ExpenseCategory,
      taxCategory:
        row.direction === "out" ? expenseCategoryToTaxCategory(category) : "Immediate Deduction",
      providerId: row.providerId,
      providerName: row.suggestedProviderName,
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "upload",
      sourceFileName: row.sourceFileName,
      sourceFileData: row.sourceFileData,
      feedProposalId: row.proposalId,
      feedLineIndex: row.lineIndex,
    });
    markProposalApplied(row.proposalId, { propertyId });
    toast.success("Recorded");
  };

  const unrecord = (r: FeedRow) => {
    if (!r.expenseId) return;
    if (!confirm("Revert this transaction back to the feed? This deletes the recorded expense."))
      return;
    deleteExpense(r.expenseId);
    toast.success("Reverted to feed");
  };

  return (
    <CollapsibleGroupSection label="Compiled bank feed" summary={<span>{rows.length}</span>}>
      <div className="p-3">
        <FeedRowList rows={rows} onRecord={setRecording} onUnrecord={unrecord} />
      </div>
      <RecordTransactionDialog
        recording={recording}
        onClose={() => setRecording(null)}
        onRecord={record}
      />
    </CollapsibleGroupSection>
  );
}

/** Every bank-statement transaction not tied to a specific account — an email-forwarded statement
 * (nothing to pre-target it at) or one uploaded before this account was added. Kept visible and
 * recordable rather than silently dropped, but not filed under any one account's own sections. */
function UnassignedBankFeed() {
  const { state, addExpense, deleteExpense, markProposalApplied } = useStore();
  const proposals = relevantBankStatementProposals(state.aiProposals, (p) => !p.bankAccountId);
  const rows = buildFeedRows(proposals, state.expenses);
  const [recording, setRecording] = useState<FeedRow | null>(null);
  if (rows.length === 0) return null;

  const record = (row: FeedRow, propertyId: string, category: string) => {
    addExpense({
      itemName: row.description,
      cost: row.amount,
      date: row.date,
      propertyId,
      direction: row.direction === "in" ? "Income" : undefined,
      category: category as ExpenseCategory,
      taxCategory:
        row.direction === "out" ? expenseCategoryToTaxCategory(category) : "Immediate Deduction",
      providerId: row.providerId,
      providerName: row.suggestedProviderName,
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "upload",
      sourceFileName: row.sourceFileName,
      sourceFileData: row.sourceFileData,
      feedProposalId: row.proposalId,
      feedLineIndex: row.lineIndex,
    });
    markProposalApplied(row.proposalId, { propertyId });
    toast.success("Recorded");
  };

  const unrecord = (r: FeedRow) => {
    if (!r.expenseId) return;
    if (!confirm("Revert this transaction back to the feed? This deletes the recorded expense."))
      return;
    deleteExpense(r.expenseId);
    toast.success("Reverted to feed");
  };

  return (
    <div className="space-y-2 border-t pt-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Unassigned transactions</div>
        <div className="text-xs text-muted-foreground">
          From a statement forwarded by email, or uploaded before it was linked to a specific
          account.
        </div>
      </div>
      <FeedRowList rows={rows} onRecord={setRecording} onUnrecord={unrecord} />
      <RecordTransactionDialog
        recording={recording}
        onClose={() => setRecording(null)}
        onRecord={record}
      />
    </div>
  );
}

/** Picks which Entity a new bank account belongs to before opening AddBankAccountDialog — that
 * dialog's own entityId prop stays required/locked (every other caller already has one in
 * context), so the picker lives here instead of loosening its API for this one page. */
function AddBankAccountEntry() {
  const { state } = useStore();
  const [entityId, setEntityId] = useState(state.entities[0]?.id ?? "");
  if (state.entities.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        Add an entity first (Entities page) before adding a bank account.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Select value={entityId} onValueChange={setEntityId}>
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue placeholder="Owning entity" />
        </SelectTrigger>
        <SelectContent>
          {state.entities.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AddBankAccountDialog entityId={entityId} />
    </div>
  );
}

/** Portfolio-wide "Bank Accounts" — add each everyday/cash account here once, upload its
 * statements against it (like a Loan's own "Upload statement"), then record whichever
 * transactions belong to which property straight from its own Compiled bank feed. */
export function BankAccountsContent() {
  const { state } = useStore();
  const accounts = state.bankAccounts;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Bank Accounts</div>
          <div className="text-xs text-muted-foreground">
            An everyday account isn't tied to one property — add it once here, then record each
            transaction against whichever property it actually belongs to.
          </div>
        </div>
        <AddBankAccountEntry />
      </div>

      {accounts.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-xs text-muted-foreground">
            No bank accounts added yet.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {accounts.map((a) => (
          <div key={a.id} className="rounded border p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{a.accountName}</div>
                <div className="text-muted-foreground">
                  {a.institution || "—"} · {a.accountType ?? "Transaction"}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <UploadDocumentDialog
                  bankAccountId={a.id}
                  trigger={
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Upload statement"
                    >
                      <FileUp className="h-3 w-3" />
                    </Button>
                  }
                />
                <AddBankAccountDialog
                  account={a}
                  entityId={a.entityId}
                  trigger={
                    <Button size="icon" variant="ghost" className="h-6 w-6">
                      <Pencil className="h-3 w-3" />
                    </Button>
                  }
                />
              </div>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
              <span>Balance: {fmtCurrency(a.currentBalance)}</span>
              <span>BSB: {a.bsb || "—"}</span>
              <span>Account: {a.accountNumber || "—"}</span>
            </div>
            <div className="mt-2 space-y-2">
              <BankAccountStatementFiles account={a} />
              <BankAccountFeed account={a} />
            </div>
          </div>
        ))}
      </div>

      <UnassignedBankFeed />
    </div>
  );
}
