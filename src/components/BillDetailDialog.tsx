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
import { CheckCircle2, Trash2, Pencil, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fmtCurrency, todayISO, expenseCategoryToTaxCategory, billTypeToDefaultCategory, CATEGORY_GROUPS, fmtModified } from "@/lib/calculations";
import { BillLineItemsEditor } from "@/components/BillLineItemsEditor";
import { InstalmentScheduleEditor } from "@/components/InstalmentScheduleEditor";
import { instalmentBills, instalmentLabel, sharedBillFields, validateInstalments, type InstalmentRow } from "@/lib/instalments";
import { billLinesToRows, blankBillLine, lineWantsRecharge, newlyRechargedLines, planBillLines, type BillLineRow } from "@/lib/billLines";
import { emailTenant, rechargeEmail } from "@/lib/tenantEmails";
import type { ExpenseCategory, PropertyBill } from "@/lib/types";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { useAiExtraction } from "@/lib/useAiExtraction";
import { BillPaymentControl, useBillActions } from "@/components/MarkBillPaidDialog";
import { SHARED_UNIT, uid } from "@/lib/constants";
import { ExtractBillResult } from "@/lib/types";
import { documentLayout } from "@/lib/documentLayout";



/** A saved bill's lines as editable rows — at least one, so there's always a row to type into. */
const toLineItemRows = (b: PropertyBill): BillLineRow[] => {
  const rows = billLinesToRows(b.lineItems, b.billType);
  return rows.length > 0 ? rows : [blankBillLine(b.billType)];
};


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
  const { state, updateBill, deleteBill, addBill, addInvoice, findOrCreateProvider } = useStore();
  const billActions = useBillActions();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(bill.id);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleRows, setScheduleRows] = useState<InstalmentRow[]>([]);
  // Saved instalments removed while editing — only deleted on "Done", not the moment the bin is
  // clicked, so abandoning the edit doesn't lose them.
  const [removedIds, setRemovedIds] = useState<string[]>([]);
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

  /** Re-runs the AI reader on the attached PDF — for a bill saved while the reader was down (e.g.
   * Gemini overloaded), so it isn't stuck as one unsplit total. Only fills the form; nothing is
   * stored until Save, same as any other edit here. */
  const reading = useAiExtraction<ExtractBillResult>({
    fn: "extract-bill",
    fallbackError: "Couldn't read this bill",
    apply: (data) => {
      if (data.line_items?.length) {
        setLineItems(data.line_items.map((li) => blankBillLine(selected.billType, { description: li.description, amount: String(li.amount) })));
      }
      setForm((f) => ({
        ...f,
        referenceNumber: f.referenceNumber || data.reference_number || data.bpay_reference || "",
        bpayBillerCode: f.bpayBillerCode || data.bpay_biller_code || "",
        bpayReference: f.bpayReference || data.bpay_reference || "",
      }));
      const n = data.line_items?.length ?? 0;
      return {
        empty: !data.vendor && !data.amount,
        message: n > 1 ? `Read ${n} line items — check them and click Save` : "Read the bill, but it has no itemised breakdown — check the fields and click Save",
      };
    },
  });
  const readWithAi = () => {
    if (lineItems.some((li) => li.recharged)) {
      return toast.error("A line on this bill has already been recharged to the tenant — edit the lines by hand instead");
    }
    void reading.reread(selected.sourceFileName, selected.sourceFileData);
  };

  const layout = documentLayout(docExpanded, { dialog: "max-h-[90vh] max-w-4xl overflow-y-auto", cols: "md:grid-cols-2" });
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
        landlordName: state.landlordProfile.fullName,
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
      // A renamed provider is re-matched (same shared rule as everywhere else) — the bill used to
      // keep pointing at the old provider record after its name was edited here.
      providerId:
        form.providerName.trim() && form.providerName.trim() !== (selected.providerName ?? "").trim()
          ? findOrCreateProvider(form.providerName, selected.propertyId, form.category)
          : selected.providerId,
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
        label: s.label ?? instalmentLabel(idx + 1),
        dueDate: s.dueDate,
        amount: String(s.amount),
      })),
    );
    setRemovedIds([]);
    setEditingSchedule(true);
  };

  const saveSchedule = () => {
    const error = validateInstalments(scheduleRows);
    if (error) return toast.error(error);
    const groupId = bill.billGroupId ?? uid("bg");
    for (const id of removedIds) deleteBill(id);
    for (const row of scheduleRows) {
      if (row.id) updateBill(row.id, { label: row.label, dueDate: row.dueDate, amount: parseFloat(row.amount) || 0 });
    }
    // New instalments copy every shared field from this bill (category, tax category, provider,
    // dwelling, …) — the same helper a new bill's schedule uses.
    instalmentBills(sharedBillFields(selected), scheduleRows.filter((r) => !r.id), groupId).forEach(addBill);
    setEditingSchedule(false);
    toast.success("Payment schedule updated");
  };

  const removeScheduleRow = (row: InstalmentRow) => {
    if (row.id && scheduleRows.filter((r) => r.id).length <= 1) {
      return toast.error("Can't remove the only instalment — delete the bill instead");
    }
    if (row.id) setRemovedIds((ids) => [...ids, row.id!]);
    setScheduleRows((rows) => rows.filter((r) => r.key !== row.key));
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
        className={layout.dialog}
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

        <div className={layout.grid}>
          <div className={layout.left}>
            {selected.sourceFileData && (
              <Button size="sm" variant="outline" className="mb-2 h-7 gap-1 text-xs" disabled={reading.busy} onClick={readWithAi}>
                <RefreshCw className={"h-3 w-3" + (reading.busy ? " animate-spin" : "")} />
                {reading.busy ? "Reading…" : "Read with AI"}
              </Button>
            )}
            <BillDocumentViewer
              fileName={selected.sourceFileName}
              fileData={selected.sourceFileData}
              expanded={docExpanded}
              onToggleExpand={() => setDocExpanded((v) => !v)}
            />
          </div>

          <div className={"space-y-4 " + layout.right}>
            {siblings.length > 1 && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Payment instalments</div>
                  <Button size="sm" variant="ghost" className="h-6 gap-1 text-xs" onClick={editingSchedule ? saveSchedule : startEditSchedule}>
                    <Pencil className="h-3 w-3" /> {editingSchedule ? "Done" : "Edit schedule"}
                  </Button>
                </div>

                {editingSchedule ? (
                  <InstalmentScheduleEditor rows={scheduleRows} onChange={setScheduleRows} onRemove={removeScheduleRow} />
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
                          {s.label ?? instalmentLabel(idx + 1)}
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
                  <BillPaymentControl bill={selected} />
                </div>
              </div>
            )}

            {/* Single-instalment bills have no "Payment instalments" block above (there's only one
                due date to track) — the pay/unpay control still needs to be evident during review,
                not tucked away only in the Bills board's row menu. */}
            {siblings.length <= 1 && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="text-xs font-medium">Payment</div>
                <BillPaymentControl bill={selected} />
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
                  if (billActions.remove(selected, { instalment: siblings.length > 1 })) setOpen(false);
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
