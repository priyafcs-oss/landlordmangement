import { useState } from "react";
import { useStore } from "@/lib/store";
import { fmtCurrency, expenseCategoryToTaxCategory, likelyRentTenantId, RENT_INCOME_CATEGORY } from "@/lib/calculations";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CompiledFeedTable, type CompiledFeedRow } from "@/components/CompiledFeedTable";
import { DocumentLink } from "@/components/DocumentLink";
import { AddBankAccountDialog } from "@/components/AddBankAccountDialog";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import { DuplicateWarningDialog } from "@/components/DuplicateWarningDialog";
import { FileUp, FileText, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/types";
import {
  annotateFeedRow,
  buildFeedRows,
  existingRecordFor,
  isAcceptable,
  rowsForStatement,
  type FeedRow,
  type FeedRowAnnotation,
} from "@/lib/bankFeed";
import type { DuplicateMatch } from "@/lib/billMatch";
import type {
  AiIntakeProposal,
  BankAccount,
  BankStatementProposalPayload,
  ExpenseCategory,
  LedgerEntry,
} from "@/lib/types";

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
  onRecord: (args: RecordArgs) => void;
}) {
  const { state } = useStore();
  const [category, setCategory] = useState<string>("");
  const [propertyId, setPropertyId] = useState("");
  const [tenantId, setTenantId] = useState("");

  const isRent = recording?.direction === "in" && category === RENT_INCOME_CATEGORY;
  const tenantsHere = state.tenants.filter((t) => t.propertyId === propertyId);
  const chosenTenantId = tenantsHere.some((t) => t.id === tenantId)
    ? tenantId
    : (likelyRentTenantId(state.tenants, state.ledger, propertyId) ?? "");

  // Re-seed whenever a different row opens — a stale category/property from the previous row
  // must never carry over into this one. The line's own suggestion (e.g. rent from a named
  // tenant) wins over the generic per-direction default.
  if (recording && category === "" && propertyId === "") {
    const suggestion = annotateFeedRow(recording, state).suggestion;
    const provider = recording.providerId
      ? state.providers.find((p) => p.id === recording.providerId)
      : undefined;
    setCategory(
      suggestion?.category ??
        provider?.defaultCategory ??
        (recording.direction === "in" ? "Other Rental Income" : "Sundry Rental Expenses"),
    );
    setPropertyId(suggestion?.propertyId ?? recording.suggestedPropertyId ?? "");
    setTenantId(suggestion?.tenantId ?? "");
  }

  const close = () => {
    setCategory("");
    setPropertyId("");
    setTenantId("");
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
            {isRent && tenantsHere.length > 0 && (
              <>
                <Field label="Tenant">
                  <Select value={chosenTenantId} onValueChange={setTenantId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tenantsHere.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <p className="text-xs text-muted-foreground">Recorded as a rent payment on this tenant's ledger.</p>
              </>
            )}
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
              onRecord({
                row: recording,
                propertyId,
                category,
                tenantId: isRent ? chosenTenantId || undefined : undefined,
              });
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

interface RecordArgs {
  row: FeedRow;
  propertyId: string;
  category: string;
  /** Set when the line is a rent payment for this tenant's ledger. */
  tenantId?: string;
  /** Set when the line pays this unpaid bill — marks it paid instead of a new Expense. */
  billId?: string;
}

/** Recording/unrecording a feed line — shared by a specific account's feed and the unassigned
 * bucket. `rows` is the whole feed the lines come from, used to tell when a statement has nothing
 * left to record. Render `dialog` once: it's the duplicate warning a record can stop on. */
function useFeedRecording(rows: FeedRow[]) {
  const {
    state,
    addExpense,
    deleteExpense,
    addLedger,
    deleteLedger,
    markBillPaid,
    unmarkBillPaid,
    markProposalApplied,
    updateProposal,
  } = useStore();
  const [pending, setPending] = useState<{ args: RecordArgs; match: DuplicateMatch } | null>(null);

  const write = ({ row, propertyId, category, tenantId, billId }: RecordArgs) => {
    if (billId) {
      markBillPaid(billId, {
        paidDate: row.date,
        amount: row.amount,
        feedLink: { proposalId: row.proposalId, lineIndex: row.lineIndex },
      });
    } else if (tenantId) {
      addLedger({
        tenantId,
        date: row.date,
        type: "Rent Payment",
        description: row.description,
        debit: 0,
        credit: row.amount,
        source: "bank_feed",
        sourceFileName: row.sourceFileName,
        sourceFileData: row.sourceFileData,
        feedProposalId: row.proposalId,
        feedLineIndex: row.lineIndex,
      });
    } else {
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
    }
  };

  /** A statement stays "pending" (and on the Needs-your-approval list) until every line on it is
   * recorded or it's marked reviewed — recording its first line used to mark it done outright.
   * Also files the statement under the property its first recorded line went to, as before. */
  const settle = (recorded: RecordArgs[]) => {
    const recordedRows = new Set(recorded.map((a) => a.row));
    const statementIds = new Set(recorded.flatMap((a) => a.row.copies.map((c) => c.proposalId)));
    for (const id of statementIds) {
      const proposal = state.aiProposals.find((p) => p.id === id);
      if (!proposal) continue;
      const firstPropertyId = recorded.find((a) => a.row.copies.some((c) => c.proposalId === id))?.propertyId;
      if (!proposal.propertyId && firstPropertyId) updateProposal(id, { propertyId: firstPropertyId });
      const open = rowsForStatement(rows, id).filter((r) => !r.recorded && !recordedRows.has(r));
      if (open.length === 0 && proposal.status === "pending") markProposalApplied(id);
    }
  };

  const record = (args: RecordArgs) => {
    // Paying an unpaid bill is what a bill suggestion is for — the duplicate check would only
    // find that same bill.
    const match = args.billId ? null : existingRecordFor(args.row, args.tenantId, args.propertyId, state);
    if (match) return setPending({ args, match });
    write(args);
    settle([args]);
    toast.success(args.billId ? "Bill marked paid" : args.tenantId ? "Recorded as rent on the tenant's ledger" : "Recorded");
  };

  /** "Accept all suggestions" — only lines with nothing already on the books, and skipping any
   * that would duplicate another line earlier in this same batch (e.g. two same-amount deposits a
   * day apart both suggested as one tenant's rent), since those don't exist in state yet to check. */
  const recordMany = (list: RecordArgs[]) => {
    const batchLedger: LedgerEntry[] = [];
    const batchBills = new Set<string>();
    const accepted: RecordArgs[] = [];
    for (const args of list) {
      if (args.billId) {
        // Two lines matching the same bill — only the first pays it.
        if (batchBills.has(args.billId)) continue;
        batchBills.add(args.billId);
      } else {
        const ledger = [...state.ledger, ...batchLedger];
        if (existingRecordFor(args.row, args.tenantId, args.propertyId, { ...state, ledger })) continue;
      }
      write(args);
      accepted.push(args);
      if (args.tenantId) {
        batchLedger.push({
          id: `batch-${batchLedger.length}`,
          tenantId: args.tenantId,
          date: args.row.date,
          type: "Rent Payment",
          description: args.row.description,
          debit: 0,
          credit: args.row.amount,
        } as LedgerEntry);
      }
    }
    settle(accepted);
    const skipped = list.length - accepted.length;
    toast.success(`Recorded ${accepted.length} transaction(s)${skipped ? ` — skipped ${skipped} that looked like duplicates` : ""}`);
  };

  const unrecord = (r: FeedRow) => {
    if (!r.expenseId && !r.ledgerEntryId) return;
    const what = r.ledgerEntryId ? "rent payment from the tenant's ledger" : "recorded expense";
    const msg =
      r.recordedCount > 1
        ? `This transaction was recorded ${r.recordedCount} times (once from each overlapping statement). Remove one copy? This deletes one ${what}.`
        : `Revert this transaction back to the feed? This deletes the ${what}.`;
    if (!confirm(msg)) return;
    // An expense created by paying a bill from the feed is undone by un-paying the bill, which
    // deletes that expense too — deleting only the expense would leave the bill marked Paid.
    const paidBill = r.expenseId ? state.bills.find((b) => b.linkedExpenseId === r.expenseId) : undefined;
    if (r.ledgerEntryId) deleteLedger(r.ledgerEntryId);
    else if (paidBill) unmarkBillPaid(paidBill.id);
    else if (r.expenseId) deleteExpense(r.expenseId);
    toast.success(r.recordedCount > 1 ? "Removed the extra copy" : "Reverted to feed");
  };

  const dialog = (
    <DuplicateWarningDialog
      match={pending?.match ?? null}
      onCancel={() => setPending(null)}
      onSaveAnyway={() => {
        if (!pending) return;
        write(pending.args);
        settle([pending.args]);
        setPending(null);
        toast.success("Recorded");
      }}
    />
  );

  return { record, recordMany, unrecord, dialog };
}

function existingLabel(m: DuplicateMatch): string {
  const what = m.kind === "rent" ? "rent payment" : m.kind === "bill" ? "bill" : "transaction";
  return `Possible duplicate — a ${fmtCurrency(m.amount)} ${what} dated ${m.date} is already recorded${m.label ? ` ("${m.label}")` : ""}`;
}

type AnnotatedRow = FeedRowAnnotation & { row: FeedRow };

function annotate(rows: FeedRow[], state: ReturnType<typeof useStore>["state"]): AnnotatedRow[] {
  return rows.map((row) => (row.recorded ? { row, suggestion: null, existing: null } : { row, ...annotateFeedRow(row, state) }));
}

function argsFromSuggestion(a: AnnotatedRow): RecordArgs {
  const s = a.suggestion!;
  return { row: a.row, propertyId: s.propertyId!, category: s.category, tenantId: s.tenantId, billId: s.billId };
}

function FeedRowList({
  rows,
  onRecord,
  onAccept,
  onUnrecord,
}: {
  rows: AnnotatedRow[];
  onRecord: (r: FeedRow) => void;
  onAccept: (a: AnnotatedRow) => void;
  onUnrecord: (r: FeedRow) => void;
}) {
  const tableRows: CompiledFeedRow[] = rows.map((a) => {
    const r = a.row;
    return {
      key: `${r.proposalId}-${r.lineIndex}`,
      date: r.date,
      description: r.description,
      amount: r.amount,
      direction: r.direction === "in" ? "credit" : "debit",
      status: r.recorded ? "recorded" : "feed_only",
      onRecord: !r.recorded ? () => onRecord(r) : undefined,
      onUnrecord: r.recorded && (r.expenseId || r.ledgerEntryId) ? () => onUnrecord(r) : undefined,
      note: r.copies.length > 1 ? `On ${r.copies.length} overlapping statements — shown once` : undefined,
      warning:
        r.recordedCount > 1
          ? `Recorded ${r.recordedCount} times (once per overlapping statement) — Unrecord removes the extra`
          : a.existing
            ? existingLabel(a.existing)
            : undefined,
      // Flagged even without a known property (it can't be accepted in one click then, but a
      // property expense on an everyday account is exactly what shouldn't slip past unnoticed).
      suggestion:
        a.suggestion && !a.existing && !r.recorded
          ? {
              label: a.suggestion.propertyId ? a.suggestion.label : `${a.suggestion.label} · pick property`,
              reason: a.suggestion.reason,
              tone: a.suggestion.kind === "rent" ? "rent" : "expense",
              onAccept: isAcceptable(a) ? () => onAccept(a) : undefined,
            }
          : undefined,
    };
  });
  return <CompiledFeedTable rows={tableRows} />;
}

/** One compiled feed (an account's, or the unassigned bucket's) — the table, its Accept-all
 * action, the record dialog and the duplicate warning, shared by both. */
function FeedSection({ proposals }: { proposals: AiIntakeProposal[] }) {
  const { state } = useStore();
  const rows = buildFeedRows(proposals, state);
  const { record, recordMany, unrecord, dialog } = useFeedRecording(rows);
  const [recording, setRecording] = useState<FeedRow | null>(null);
  const annotated = annotate(rows, state);
  const suggested = annotated.filter(isAcceptable);
  const flagged = annotated.filter((a) => a.suggestion && !a.existing && !a.row.recorded);
  const expenseFlags = flagged.filter((a) => a.suggestion!.kind !== "rent").length;
  const rentFlags = flagged.length - expenseFlags;

  return (
    <div className="space-y-2">
      {flagged.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          <span className="flex flex-wrap items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-amber-600" />
            {expenseFlags > 0 && (
              <span className="font-medium text-amber-800 dark:text-amber-300">
                {expenseFlags} possible property expense(s) to record
              </span>
            )}
            {expenseFlags > 0 && rentFlags > 0 && <span>·</span>}
            {rentFlags > 0 && <span className="text-primary">{rentFlags} rent deposit(s) matched to a tenant</span>}
            <span className="text-muted-foreground">— use the "Flagged" filter to see just these.</span>
          </span>
          {suggested.length > 0 && (
            <Button
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                if (!confirm(`Record all ${suggested.length} suggested line(s) as suggested?`)) return;
                recordMany(suggested.map(argsFromSuggestion));
              }}
            >
              Accept all suggestions ({suggested.length})
            </Button>
          )}
        </div>
      )}
      <FeedRowList
        rows={annotated}
        onRecord={setRecording}
        onAccept={(a) => record(argsFromSuggestion(a))}
        onUnrecord={unrecord}
      />
      <RecordTransactionDialog recording={recording} onClose={() => setRecording(null)} onRecord={record} />
      {dialog}
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

/** One bank account's own uploaded/emailed statements — file name, period, View. A statement
 * stays "New" until every line is recorded or it's marked reviewed here (e.g. the rest are
 * personal transactions that will never be recorded). */
function BankAccountStatementFiles({ account }: { account: BankAccount }) {
  const { state, markProposalApplied } = useStore();
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
              {p.status === "pending" ? (
                <>
                  <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                    New
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    title="Done with this statement — any lines left are not being recorded"
                    onClick={() => markProposalApplied(p.id)}
                  >
                    Mark reviewed
                  </Button>
                </>
              ) : (
                <Badge variant="secondary">Reviewed</Badge>
              )}
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
  const { state } = useStore();
  const proposals = relevantBankStatementProposals(
    state.aiProposals,
    (p) => p.bankAccountId === account.id,
  );
  if (proposals.length === 0) return null;
  const lineCount = buildFeedRows(proposals, state).length;

  return (
    <CollapsibleGroupSection label="Compiled bank feed" summary={<span>{lineCount}</span>}>
      <div className="p-3">
        <FeedSection proposals={proposals} />
      </div>
    </CollapsibleGroupSection>
  );
}

/** Every bank-statement transaction not tied to a specific account — an email-forwarded statement
 * (nothing to pre-target it at) or one uploaded before this account was added. Kept visible and
 * recordable rather than silently dropped, but not filed under any one account's own sections. */
function UnassignedBankFeed() {
  const { state } = useStore();
  const proposals = relevantBankStatementProposals(state.aiProposals, (p) => !p.bankAccountId);
  if (proposals.length === 0) return null;

  return (
    <div className="space-y-2 border-t pt-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Unassigned transactions</div>
        <div className="text-xs text-muted-foreground">
          From a statement forwarded by email, or uploaded before it was linked to a specific
          account.
        </div>
      </div>
      <FeedSection proposals={proposals} />
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
