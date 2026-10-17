import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CheckCircle2, Trash2, Plus, Pencil, Mail, Undo2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fmtCurrency, todayISO, expenseCategoryToTaxCategory, billTypeToDefaultCategory, CATEGORY_GROUPS, fmtModified, billOwed } from "@/lib/calculations";
import { BillLineItemsEditor } from "@/components/BillLineItemsEditor";
import { billLinesToRows, blankBillLine, lineWantsRecharge, newlyRechargedLines, planBillLines, type BillLineRow } from "@/lib/billLines";
import { emailTenant, rechargeEmail } from "@/lib/tenantEmails";
import type { ExpenseCategory, PropertyBill } from "@/lib/types";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { extractBillFromStored } from "@/lib/billExtract";
import { MarkBillPaidDialog } from "@/components/MarkBillPaidDialog";
import { SHARED_UNIT, uid } from "@/lib/constants";


interface InstalmentEditRow {
  id?: string;
  key: string;
  label: string;
  dueDate: string;
  amount: string;
}

/** A saved bill's lines as editable rows — at least one, so there's always a row to type into. */
const toLineItemRows = (b: PropertyBill): BillLineRow[] => {
  const rows = billLinesToRows(b.lineItems, b.billType);
  return rows.length > 0 ? rows : [blankBillLine(b.billType)];
};

/**
 * Pay/unpay control for one bill row — a "Mark paid" trigger when Unpaid/Overdue, or the paid
 * details (date, method, amount if it differed) plus an "Unpay" undo when Paid. Shown unconditionally
 * during review (not hidden while editing the payment schedule) so it's always evident how to
 * record or undo a payment.
 */
function PayStatusControl({ bill }: { bill: PropertyBill }) {
  const { unmarkBillPaid } = useStore();
  if (bill.status !== "Paid" && bill.status !== "Partial") {
    return <MarkBillPaidDialog bill={bill} trigger={<Button size="sm" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Mark paid</Button>} />;
  }

  const undoButton = (
    <Button
      size="sm"
      variant="outline"
      className="gap-1"
      onClick={() => {
        if (confirm("Undo this payment? The linked transaction will be removed.")) {
          unmarkBillPaid(bill.id);
          toast.success("Payment undone");
        }
      }}
    >
      <Undo2 className="h-3 w-3" /> Unpay
    </Button>
  );

  if (bill.status === "Partial") {
    const owed = billOwed(bill);
    return (
      <div className="flex items-center gap-2">
        <div className="text-right text-xs text-amber-700">
          <div className="font-medium">Partial — {fmtCurrency(bill.paidAmount ?? 0)} of {fmtCurrency(bill.amount)}</div>
          <div className="text-muted-foreground">{fmtCurrency(owed)} still owed</div>
        </div>
        <MarkBillPaidDialog bill={bill} trigger={<Button size="sm" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Pay remainder</Button>} />
        {undoButton}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="text-right text-xs text-emerald-700">
        <div className="flex items-center gap-1 font-medium">
          <CheckCircle2 className="h-3 w-3" /> Paid {bill.paidDate}
        </div>
        <div className="text-muted-foreground">
          {bill.paymentMethod ?? "—"}
          {bill.paidAmount !== undefined && bill.paidAmount !== bill.amount ? ` · ${fmtCurrency(bill.paidAmount)}` : ""}
        </div>
      </div>
      {undoButton}
    </div>
  );
}

/**
 * Click-through detail view for a single bill (or, when it's part of a scheduled-payment group,
 * the whole group) — the source document side-by-side with editable details, the payment schedule,
 * and per-instalment "record paid". Shared/denormalized fields (provider, reference, BPAY, period,
 * line items, notes) live on every sibling row, so saving here writes them to every row in the
 * group at once, keeping them in sync.
 */
export function BillDetailDialog({
  bill,
  propertyLabel,
  trigger,
}: {
  bill: PropertyBill;
  propertyLabel?: string;
  trigger: React.ReactNode;
}) {
  const { state, updateBill, deleteBill, addBill, unmarkBillPaid, addInvoice } = useStore();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(bill.id);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleRows, setScheduleRows] = useState<InstalmentEditRow[]>([]);
  // Whether the document pane — and this whole dialog — is enlarged, so "Enlarge" on the source
  // document grows the review window (document + editable fields together), not just the pane.
  const [docExpanded, setDocExpanded] = useState(false);

  const siblings = (bill.billGroupId ? state.bills.filter((b) => b.billGroupId === bill.billGroupId) : [bill]).sort(
    (a, b) => (a.dueDate < b.dueDate ? -1 : 1),
  );
  const selected = siblings.find((b) => b.id === selectedId) ?? bill;

  const [form, setForm] = useState({
    providerName: bill.providerName ?? "",
    referenceNumber: bill.referenceNumber ?? "",
    bpayBillerCode: bill.bpayBillerCode ?? "",
    bpayReference: bill.bpayReference ?? "",
    issueDate: bill.issueDate ?? "",
    periodStart: bill.periodStart ?? "",
    periodEnd: bill.periodEnd ?? "",
    notes: bill.notes ?? "",
    dueDate: bill.dueDate,
    category: (bill.category ?? billTypeToDefaultCategory(bill.billType)) as ExpenseCategory,
    unitId: bill.unitId ?? SHARED_UNIT,
  });
  const [lineItems, setLineItems] = useState<BillLineRow[]>(() => toLineItemRows(bill));

  const resetFrom = (b: PropertyBill) => {
    setSelectedId(b.id);
    setForm({
      providerName: b.providerName ?? "",
      referenceNumber: b.referenceNumber ?? "",
      bpayBillerCode: b.bpayBillerCode ?? "",
      bpayReference: b.bpayReference ?? "",
      issueDate: b.issueDate ?? "",
      periodStart: b.periodStart ?? "",
      periodEnd: b.periodEnd ?? "",
      notes: b.notes ?? "",
      dueDate: b.dueDate,
      category: (b.category ?? billTypeToDefaultCategory(b.billType)) as ExpenseCategory,
      unitId: b.unitId ?? SHARED_UNIT,
    });
    setLineItems(toLineItemRows(b));
    setEditingSchedule(false);
  };

  const netTotal = lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);
  const tenantsForProperty = state.tenants.filter((t) => t.propertyId === selected.propertyId);
  const [reading, setReading] = useState(false);

  /** Re-runs the AI reader on the attached PDF — for a bill saved while the reader was down (e.g.
   * Gemini overloaded), so it isn't stuck as one unsplit total. Only fills the form; nothing is
   * stored until Save, same as any other edit here. */
  const readWithAi = async () => {
    if (lineItems.some((li) => li.recharged)) {
      return toast.error("A line on this bill has already been recharged to the tenant — edit the lines by hand instead");
    }
    setReading(true);
    try {
      const data = await extractBillFromStored(selected.sourceFileName, selected.sourceFileData);
      if (data.line_items?.length) {
        setLineItems(data.line_items.map((li) => blankBillLine(selected.billType, { description: li.description, amount: String(li.amount) })));
      }
      setForm((f) => ({
        ...f,
        referenceNumber: f.referenceNumber || data.reference_number || data.bpay_reference || "",
        bpayBillerCode: f.bpayBillerCode || data.bpay_biller_code || "",
        bpayReference: f.bpayReference || data.bpay_reference || "",
      }));
      toast.success(
        (data.line_items?.length ?? 0) > 1
          ? `Read ${data.line_items!.length} line items — check them and click Save`
          : "Read the bill, but it has no itemised breakdown — check the fields and click Save",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read this bill");
    } finally {
      setReading(false);
    }
  };
  const hasNewRecharge = newlyRechargedLines(selected.billType, lineItems).length > 0;
  const propertyUnits = state.properties.find((p) => p.id === selected.propertyId)?.units ?? [];

  const emailTenantAboutLineItem = (li: BillLineRow) => {
    const tenant = tenantsForProperty.find((t) => t.id === li.tenantId);
    return emailTenant(
      tenant,
      rechargeEmail({
        tenantName: tenant?.name ?? "",
        propertyLabel,
        billType: selected.billType,
        description: li.description,
        amount: parseFloat(li.amount) || 0,
      }),
      { fileName: selected.sourceFileName, fileData: selected.sourceFileData },
    );
  };

  /** Saves the bill; with `notify`, then emails the tenant about each line newly recharged by this
   * save — the same "Save & Notify Tenant" the first-time review has. */
  const saveDetails = (notify = false) => {
    if (lineItems.some((li) => lineWantsRecharge(selected.billType, li) && !li.recharged && !li.tenantId)) {
      return toast.error("Select a tenant for every line item flagged to recharge");
    }
    const toNotify = newlyRechargedLines(selected.billType, lineItems);
    const { lineItems: savedLines, invoices } = planBillLines(lineItems, {
      billType: selected.billType,
      date: form.issueDate || selected.issueDate || todayISO(),
    });
    invoices.forEach(addInvoice);

    const patch = {
      providerName: form.providerName || undefined,
      referenceNumber: form.referenceNumber || undefined,
      bpayBillerCode: form.bpayBillerCode || undefined,
      bpayReference: form.bpayReference || undefined,
      issueDate: form.issueDate || undefined,
      periodStart: form.periodStart || undefined,
      periodEnd: form.periodEnd || undefined,
      notes: form.notes || undefined,
      category: form.category,
      taxCategory: expenseCategoryToTaxCategory(form.category),
      unitId: form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      lineItems: savedLines,
      amount: netTotal > 0 ? netTotal : selected.amount,
      // Saving here means the landlord has looked at this bill and made a call on the recharge
      // decision (whether or not they actually ticked recharge) — clears the Dashboard follow-up.
      tenantRebillStatus: selected.tenantRebillStatus === "pending" ? ("resolved" as const) : selected.tenantRebillStatus,
    };
    // Shared fields are denormalized onto every row in the group — keep them in sync.
    for (const sib of siblings) {
      updateBill(sib.id, sib.id === selected.id ? { ...patch, dueDate: form.dueDate } : patch);
    }
    // Reload the rows from what was saved, so newly recharged lines now read "Recharged" — otherwise
    // pressing Save again invoiced the tenant a second time.
    setLineItems(billLinesToRows(savedLines, selected.billType));
    if (notify) for (const li of toNotify) void emailTenantAboutLineItem(li);
    toast.success("Bill updated");
  };

  const startEditSchedule = () => {
    setScheduleRows(
      siblings.map((s, idx) => ({
        id: s.id,
        key: s.id,
        label: s.label ?? (idx === 0 ? "1st instalment" : `Instalment ${idx + 1}`),
        dueDate: s.dueDate,
        amount: String(s.amount),
      })),
    );
    setEditingSchedule(true);
  };

  const saveSchedule = () => {
    const groupId = bill.billGroupId ?? uid("bg");
    for (const row of scheduleRows) {
      if (row.id) {
        updateBill(row.id, { label: row.label, dueDate: row.dueDate, amount: parseFloat(row.amount) || 0 });
      } else {
        addBill({
          propertyId: selected.propertyId,
          assetId: selected.assetId,
          billType: selected.billType,
          status: "Unpaid",
          providerName: selected.providerName,
          referenceNumber: selected.referenceNumber,
          bpayBillerCode: selected.bpayBillerCode,
          bpayReference: selected.bpayReference,
          periodStart: selected.periodStart,
          periodEnd: selected.periodEnd,
          lineItems: selected.lineItems,
          sourceFileName: selected.sourceFileName,
          sourceFileData: selected.sourceFileData,
          billGroupId: groupId,
          label: row.label,
          dueDate: row.dueDate,
          amount: parseFloat(row.amount) || 0,
        });
      }
    }
    setEditingSchedule(false);
    toast.success("Payment schedule updated");
  };

  const removeScheduleRow = (key: string) => {
    const row = scheduleRows.find((r) => r.key === key);
    if (row?.id) {
      if (siblings.length <= 1) return toast.error("Can't remove the only instalment — delete the bill instead");
      deleteBill(row.id);
    }
    setScheduleRows((rows) => rows.filter((r) => r.key !== key));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) resetFrom(bill);
        else setDocExpanded(false);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={
          docExpanded
            ? "flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-y-auto"
            : "max-h-[90vh] max-w-4xl overflow-y-auto"
        }
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{selected.providerName || selected.billType}</DialogTitle>
            <Badge variant={selected.status === "Paid" ? "secondary" : "outline"}>{selected.status}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Review and update bill details.
            {(selected.updatedAt || selected.created_at) && (
              <> · {selected.updatedAt ? `Edited ${fmtModified(selected.updatedAt)}` : `Added ${fmtModified(selected.created_at)}`}</>
            )}
          </div>
        </DialogHeader>

        <div className={"grid gap-4 text-sm " + (docExpanded ? "flex-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_380px]" : "md:grid-cols-2")}>
          <div className={docExpanded ? "overflow-y-auto pr-1" : ""}>
            {selected.sourceFileData && (
              <Button size="sm" variant="outline" className="mb-2 h-7 gap-1 text-xs" disabled={reading} onClick={() => void readWithAi()}>
                <RefreshCw className={"h-3 w-3" + (reading ? " animate-spin" : "")} />
                {reading ? "Reading…" : "Read with AI"}
              </Button>
            )}
            <BillDocumentViewer
              fileName={selected.sourceFileName}
              fileData={selected.sourceFileData}
              expanded={docExpanded}
              onToggleExpand={() => setDocExpanded((v) => !v)}
            />
          </div>

          <div className={"space-y-4 " + (docExpanded ? "overflow-y-auto pl-1" : "")}>
            {siblings.length > 1 && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Payment instalments</div>
                  <Button size="sm" variant="ghost" className="h-6 gap-1 text-xs" onClick={editingSchedule ? saveSchedule : startEditSchedule}>
                    <Pencil className="h-3 w-3" /> {editingSchedule ? "Done" : "Edit schedule"}
                  </Button>
                </div>

                {editingSchedule ? (
                  <div className="space-y-2">
                    {scheduleRows.map((row) => (
                      <div key={row.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                        <Field label="Label">
                          <Input value={row.label} onChange={(e) => setScheduleRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, label: e.target.value } : r)))} />
                        </Field>
                        <Field label="Due date">
                          <Input type="date" value={row.dueDate} onChange={(e) => setScheduleRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, dueDate: e.target.value } : r)))} />
                        </Field>
                        <Field label="Amount">
                          <Input type="number" step="0.01" value={row.amount} onChange={(e) => setScheduleRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))} />
                        </Field>
                        <Button size="icon" variant="ghost" onClick={() => removeScheduleRow(row.key)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setScheduleRows((rows) => [...rows, { key: uid("inst"), label: `Instalment ${rows.length + 1}`, dueDate: "", amount: "" }])}
                    >
                      <Plus className="h-3 w-3" /> Add instalment
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {siblings.map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className={
                          "rounded-md border px-2 py-1 text-left text-xs " +
                          (s.id === selected.id ? "border-primary ring-1 ring-primary" : "")
                        }
                      >
                        <div className="flex items-center gap-1 font-medium">
                          {s.status === "Paid" && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                          {s.label ?? (idx === 0 ? "1st instalment" : `Instalment ${idx + 1}`)}
                        </div>
                        <div className="text-muted-foreground">
                          Due {s.dueDate} · {fmtCurrency(s.amount)} · {s.status}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between border-t pt-2">
                  <div className="text-xs text-muted-foreground">
                    Selected: {selected.label ?? selected.billType} — {fmtCurrency(selected.amount)}
                  </div>
                  <PayStatusControl bill={selected} />
                </div>
              </div>
            )}

            {/* Single-instalment bills have no "Payment instalments" block above (there's only one
                due date to track) — the pay/unpay control still needs to be evident during review,
                not tucked away only in the Bills board's row menu. */}
            {siblings.length <= 1 && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="text-xs font-medium">Payment</div>
                <PayStatusControl bill={selected} />
              </div>
            )}

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Details</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Property">
                    <div className="text-xs text-muted-foreground">{propertyLabel ?? "—"}</div>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Provider name">
                    <Input value={form.providerName} onChange={(e) => setForm((f) => ({ ...f, providerName: e.target.value }))} />
                  </Field>
                </div>
                {propertyUnits.length > 0 && (
                  <div className="sm:col-span-2">
                    <Field label="Dwelling">
                      <Select value={form.unitId} onValueChange={(v) => setForm((f) => ({ ...f, unitId: v }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SHARED_UNIT}>Shared / whole property</SelectItem>
                          {propertyUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                )}
                <Field label="Reference #">
                  <Input value={form.referenceNumber} onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))} />
                </Field>
                <Field label="Category">
                  <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as ExpenseCategory }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_GROUPS).map(([group, categories]) => (
                        <SelectGroup key={group}>
                          <SelectLabel>{group}</SelectLabel>
                          {categories.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Issue date">
                  <Input type="date" value={form.issueDate} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} />
                </Field>
                {siblings.length <= 1 && (
                  <Field label="Due date">
                    <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
                  </Field>
                )}
                <Field label="BPAY biller code">
                  <Input value={form.bpayBillerCode} onChange={(e) => setForm((f) => ({ ...f, bpayBillerCode: e.target.value }))} />
                </Field>
                <Field label="BPAY reference">
                  <Input value={form.bpayReference} onChange={(e) => setForm((f) => ({ ...f, bpayReference: e.target.value }))} />
                </Field>
                <Field label="Period start">
                  <Input type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />
                </Field>
                <Field label="Period end">
                  <Input type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />
                </Field>
              </div>
            </div>

            <BillLineItemsEditor
              rows={lineItems}
              onChange={setLineItems}
              billType={selected.billType}
              tenants={tenantsForProperty}
              propertyId={selected.propertyId ?? ""}
              excludeBillId={selected.id}
              hasDocument={!!selected.sourceFileData}
              onEmailTenant={emailTenantAboutLineItem}
            />

            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>

            <div className="flex items-center justify-between border-t pt-3">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-destructive"
                onClick={() => {
                  if (confirm(siblings.length > 1 ? "Delete this instalment?" : "Delete this bill?")) {
                    deleteBill(selected.id);
                    setOpen(false);
                    toast.success("Bill removed");
                  }
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button size="sm" variant={hasNewRecharge ? "outline" : "default"} onClick={() => saveDetails()}>
                  Save
                </Button>
                {hasNewRecharge && (
                  <Button size="sm" className="gap-1" onClick={() => saveDetails(true)}>
                    <Mail className="h-3.5 w-3.5" /> Save &amp; Notify Tenant
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
