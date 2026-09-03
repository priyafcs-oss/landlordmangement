import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CheckCircle2, Trash2, Plus, Pencil, Mail } from "lucide-react";
import { toast } from "sonner";
import { fmtCurrency, todayISO, billTypeToChargeType, expenseCategoryToTaxCategory, billTypeToDefaultCategory, CATEGORY_GROUPS, fmtModified } from "@/lib/calculations";
import { buildRechargeInvoice } from "@/lib/recharge";
import type { BillType, BillLineItem, ExpenseCategory, PropertyBill } from "@/lib/types";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { base64ToBlob, mimeForFileName } from "@/lib/files";
import { downloadPdfAndEmailViaGmail, openGmailCompose } from "@/lib/emailPdf";

const BILL_TYPES: BillType[] = ["Water", "Council Rates", "Strata", "Insurance", "Electricity", "Gas", "Other"];
const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 10);
/** Sentinel for "no specific dwelling" in the Dwelling Select — Radix Select item values can't be
 * an empty string, and shared/whole-property genuinely needs its own selectable option. */
const SHARED_UNIT = "__shared__";

interface InstalmentEditRow {
  id?: string;
  key: string;
  label: string;
  dueDate: string;
  amount: string;
}

interface LineItemRow {
  key: string;
  description: string;
  category: BillType;
  amount: string;
  gst: string;
  rechargeToTenant: boolean;
  tenantId: string;
  recharged: boolean;
}

const toLineItemRows = (items?: BillLineItem[]): LineItemRow[] =>
  items && items.length > 0
    ? items.map((li) => ({
        key: uid("li"),
        description: li.description,
        category: (li.category as BillType) ?? "Other",
        amount: String(li.amount),
        gst: li.gst ? String(li.gst) : "",
        rechargeToTenant: li.rechargeToTenant ?? false,
        tenantId: li.tenantId ?? "",
        recharged: li.recharged ?? false,
      }))
    : [{ key: uid("li"), description: "", category: "Other", amount: "", gst: "", rechargeToTenant: false, tenantId: "", recharged: false }];

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
  const { state, updateBill, deleteBill, addBill, markBillPaid, addInvoice } = useStore();
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
  const [lineItems, setLineItems] = useState<LineItemRow[]>(toLineItemRows(bill.lineItems));

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
    setLineItems(toLineItemRows(b.lineItems));
    setEditingSchedule(false);
  };

  const netTotal = lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);
  const tenantsForProperty = state.tenants.filter((t) => t.propertyId === selected.propertyId);
  const propertyUnits = state.properties.find((p) => p.id === selected.propertyId)?.units ?? [];

  /** No browser email client can attach a file automatically (a security restriction, not
   * something this app can work around) — same downloadPdfAndEmailViaGmail pattern used
   * elsewhere: download the source document, then open Gmail compose prefilled so the landlord
   * just has to attach the file that was downloaded and hit send. */
  const emailTenantAboutLineItem = (li: LineItemRow) => {
    const tenant = tenantsForProperty.find((t) => t.id === li.tenantId);
    if (!tenant) return toast.error("No tenant found for this recharge");
    const amount = parseFloat(li.amount) || 0;
    const subject = `${selected.billType} — ${li.description || "usage charge"} (${fmtCurrency(amount)})`;
    const body = `Hi ${tenant.name},\n\nThe ${propertyLabel ?? "property"} ${selected.billType.toLowerCase()} bill has come in. It includes a usage charge of ${fmtCurrency(amount)} for "${li.description}" that's payable by you under the lease — the full bill is attached for your records.\n\nCould you arrange payment of ${fmtCurrency(amount)} at your earliest convenience?\n\nThanks`;
    if (selected.sourceFileData) {
      const blob = base64ToBlob(selected.sourceFileData, mimeForFileName(selected.sourceFileName));
      downloadPdfAndEmailViaGmail({ blob, fileName: selected.sourceFileName || "bill.pdf", to: tenant.email, subject, body });
      toast.success("Bill downloaded — attach it in the Gmail draft that just opened");
    } else {
      openGmailCompose(tenant.email, subject, body);
      toast("No source document on this bill — compose opened without an attachment");
    }
  };

  const saveDetails = () => {
    if (lineItems.some((li) => li.rechargeToTenant && !li.recharged && !li.tenantId)) {
      return toast.error("Select a tenant for every line item flagged to recharge");
    }

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
      lineItems: lineItems.filter((li) => parseFloat(li.amount) > 0).map((li) => {
        const amount = parseFloat(li.amount) || 0;
        const nowRecharging = li.rechargeToTenant && li.tenantId && !li.recharged;
        if (nowRecharging) {
          addInvoice(
            buildRechargeInvoice({
              tenantId: li.tenantId,
              chargeType: billTypeToChargeType(selected.billType),
              amount,
              date: form.issueDate || selected.issueDate || todayISO(),
              description: li.description || selected.billType,
            }),
          );
        }
        return {
          description: li.description || selected.billType,
          category: li.category,
          amount,
          gst: li.gst ? parseFloat(li.gst) : undefined,
          rechargeToTenant: li.rechargeToTenant || undefined,
          tenantId: li.rechargeToTenant ? li.tenantId : undefined,
          recharged: li.recharged || nowRecharging || undefined,
        };
      }),
      amount: netTotal > 0 ? netTotal : selected.amount,
      // Saving here means the landlord has looked at this bill and made a call on the recharge
      // decision (whether or not they actually ticked recharge) — clears the Dashboard follow-up.
      tenantRebillStatus: selected.tenantRebillStatus === "pending" ? ("resolved" as const) : selected.tenantRebillStatus,
    };
    // Shared fields are denormalized onto every row in the group — keep them in sync.
    for (const sib of siblings) {
      updateBill(sib.id, sib.id === selected.id ? { ...patch, dueDate: form.dueDate } : patch);
    }
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

        <div className={"grid gap-4 text-sm " + (docExpanded ? "flex-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_1fr]" : "md:grid-cols-2")}>
          <div className={docExpanded ? "overflow-y-auto pr-1" : ""}>
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
                          <Input type="number" value={row.amount} onChange={(e) => setScheduleRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))} />
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

                {!editingSchedule && (
                  <div className="flex items-center justify-between border-t pt-2">
                    <div className="text-xs text-muted-foreground">
                      Selected: {selected.label ?? selected.billType} — {fmtCurrency(selected.amount)}
                    </div>
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={selected.status === "Paid"}
                      onClick={() => {
                        markBillPaid(selected.id);
                        toast.success("Marked paid — posted to Transactions");
                      }}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Record selected paid
                    </Button>
                  </div>
                )}
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

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Line items</div>
                <div className="text-xs text-muted-foreground">Net: {fmtCurrency(netTotal)}</div>
              </div>
              {lineItems.map((li) => (
                <div key={li.key} className="space-y-1 border-b pb-2 last:border-0 last:pb-0">
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-end gap-2">
                    <Field label="Description">
                      <Input value={li.description} onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, description: e.target.value } : r)))} />
                    </Field>
                    <Field label="Category">
                      <Select value={li.category} onValueChange={(v) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, category: v as BillType } : r)))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BILL_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Amount">
                      <Input type="number" value={li.amount} onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, amount: e.target.value } : r)))} />
                    </Field>
                    <Field label="GST">
                      <Input type="number" value={li.gst} onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, gst: e.target.value } : r)))} />
                    </Field>
                    <Button size="icon" variant="ghost" onClick={() => setLineItems((rows) => rows.filter((r) => r.key !== li.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {li.recharged ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-700">
                      Recharged to {tenantsForProperty.find((t) => t.id === li.tenantId)?.name ?? "tenant"}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 px-2 text-xs text-primary"
                        onClick={() => emailTenantAboutLineItem(li)}
                      >
                        <Mail className="h-3 w-3" /> Email tenant
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={li.rechargeToTenant}
                        onCheckedChange={(v) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, rechargeToTenant: v === true } : r)))}
                      />
                      <Label className="cursor-pointer text-xs font-normal text-muted-foreground">Recharge to tenant</Label>
                      {li.rechargeToTenant && (
                        <Select
                          value={li.tenantId}
                          onValueChange={(v) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, tenantId: v } : r)))}
                        >
                          <SelectTrigger className="h-7 w-[160px] text-xs">
                            <SelectValue placeholder="Select tenant" />
                          </SelectTrigger>
                          <SelectContent>
                            {tenantsForProperty.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  setLineItems((rows) => [
                    ...rows,
                    { key: uid("li"), description: "", category: selected.billType, amount: "", gst: "", rechargeToTenant: false, tenantId: "", recharged: false },
                  ])
                }
              >
                <Plus className="h-3 w-3" /> Add line item
              </Button>
            </div>

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
                <Button size="sm" onClick={saveDetails}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
