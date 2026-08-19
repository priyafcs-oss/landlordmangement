import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, FileUp, AlertTriangle, ChevronDown, ChevronRight, Eye, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, todayISO, EXPENSE_CATEGORIES, expenseCategoryToTaxCategory, billTypeToChargeType } from "@/lib/calculations";
import { openBillDocument } from "@/lib/files";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import type { ExpenseCategory } from "@/lib/calculations";

const LOW_CONFIDENCE_THRESHOLD = 0.85;
const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 10);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

interface LineItemRow {
  key: string;
  description: string;
  category: ExpenseCategory;
  direction: "Expense" | "Income";
  amount: string;
  gst: string;
  rechargeToTenant: boolean;
  tenantId: string;
}

const blankLineItem = (): LineItemRow => ({
  key: uid("li"),
  description: "",
  category: "Other",
  direction: "Expense",
  amount: "",
  gst: "",
  rechargeToTenant: false,
  tenantId: "",
});

interface ExtractResult {
  ok?: boolean;
  error?: string;
  vendor?: string;
  amount?: number;
  due_date?: string;
  property_address?: string;
  confidence?: number;
}

/**
 * Add Transaction — the one-off counterpart to AddBillDialog, same document pane + line-item
 * shape, minus the instalment schedule. Reuses extract-bill for AI extraction (vendor/amount/date
 * overlap enough with a general receipt to be useful, even though that endpoint's prompt is
 * bill-flavoured). Line items can split across up to two properties; each becomes its own Expense
 * row on save, since P&L/Cost Base/Tax Reports read state.expenses as flat single-category rows.
 */
export function AddTransactionDialog() {
  const { state, addExpense, addInvoice } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [extractSummary, setExtractSummary] = useState<{ vendor: string; amount: number; date: string; propertyMatched: boolean } | null>(null);
  const [extractEmpty, setExtractEmpty] = useState(false);

  const blankForm = () => ({
    propertyId: state.properties[0]?.id ?? "",
    secondPropertyId: "",
    payee: "",
    referenceNumber: "",
    date: todayISO(),
    periodStart: "",
    periodEnd: "",
    notes: "",
    sourceFileName: undefined as string | undefined,
    sourceFileData: undefined as string | undefined,
  });

  const [form, setForm] = useState(blankForm());
  const [lineItems, setLineItems] = useState<LineItemRow[]>([blankLineItem()]);

  const reset = () => {
    setForm(blankForm());
    setLineItems([blankLineItem()]);
    setConfidence(null);
    setExtractSummary(null);
    setExtractEmpty(false);
    setSplitting(false);
    setPeriodOpen(false);
    setNotesOpen(false);
  };

  const netTotal = lineItems.reduce((s, li) => s + (li.direction === "Income" ? 1 : -1) * (parseFloat(li.amount) || 0), 0);
  const tenantsForProperty = state.tenants.filter((t) => t.propertyId === form.propertyId);

  const extract = async (file: File) => {
    setBusy(true);
    setExtractSummary(null);
    setExtractEmpty(false);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Couldn't read file"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      setForm((f) => ({ ...f, sourceFileName: file.name, sourceFileData: base64 }));

      const { data, error } = await supabase.functions.invoke<ExtractResult>("extract-bill", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this document");
        return;
      }

      const matchedProperty = data.property_address
        ? state.properties.find(
            (p) =>
              p.address.toLowerCase().includes(data.property_address!.toLowerCase()) ||
              data.property_address!.toLowerCase().includes(p.address.toLowerCase()),
          )
        : undefined;

      setForm((f) => ({
        ...f,
        propertyId: matchedProperty?.id ?? f.propertyId,
        payee: data.vendor ?? f.payee,
        date: data.due_date ?? f.date,
      }));
      setLineItems([{ ...blankLineItem(), description: data.vendor ?? "", amount: data.amount ? String(data.amount) : "" }]);
      setConfidence(data.confidence ?? null);

      if (!data.vendor && !data.amount) {
        setExtractEmpty(true);
        toast.warning("Couldn't find details in this file — the fields below are ready for manual entry");
      } else {
        setExtractSummary({
          vendor: data.vendor ?? "",
          amount: data.amount ?? 0,
          date: data.due_date ?? "",
          propertyMatched: !!matchedProperty,
        });
        toast.success("Extracted — review the fields before saving");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void extract(f);
  };

  const save = () => {
    const properties = [form.propertyId, splitting ? form.secondPropertyId : ""].filter(Boolean);
    if (properties.length === 0) return toast.error("Property is required");
    if (!form.payee.trim()) return toast.error("Payee / vendor is required");
    if (netTotal === 0) return toast.error("Add at least one line item with an amount");
    if (lineItems.some((li) => li.rechargeToTenant && !li.tenantId)) {
      return toast.error("Select a tenant for every line item flagged to recharge");
    }

    const validItems = lineItems.filter((li) => parseFloat(li.amount) > 0);
    const perPropertyDivisor = properties.length;

    for (const propertyId of properties) {
      for (const li of validItems) {
        const fullAmount = parseFloat(li.amount) || 0;
        const amount = fullAmount / perPropertyDivisor;
        if (li.rechargeToTenant && li.tenantId && perPropertyDivisor === 1) {
          addInvoice({
            tenantId: li.tenantId,
            chargeType: billTypeToChargeType(li.category === "Water" ? "Water" : "Other"),
            amountDue: amount,
            dateIssued: todayISO(),
            dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            status: "Unpaid",
            description: li.description || form.payee,
          });
        }
        addExpense({
          itemName: li.description || form.payee,
          cost: amount,
          date: form.date,
          propertyId,
          taxCategory: expenseCategoryToTaxCategory(li.category),
          direction: li.direction === "Income" ? "Income" : undefined,
          hasWarranty: false,
          rechargeToTenant: !!(li.rechargeToTenant && li.tenantId && perPropertyDivisor === 1),
          tenantId: li.rechargeToTenant && perPropertyDivisor === 1 ? li.tenantId : undefined,
          recharged: li.rechargeToTenant && perPropertyDivisor === 1 ? true : undefined,
          referenceNumber: form.referenceNumber || undefined,
          periodStart: form.periodStart || undefined,
          periodEnd: form.periodEnd || undefined,
          notes: form.notes || undefined,
          status: "approved",
          source: form.sourceFileData ? "upload" : "manual",
          invoiceFileName: form.sourceFileName,
          invoiceFileData: form.sourceFileData,
        });
      }
    }

    setOpen(false);
    reset();
    toast.success("Transaction added");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="h-3 w-3" /> Add Transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New transaction</DialogTitle>
          <div className="text-xs text-muted-foreground">Upload a receipt for AI extraction, or enter the details manually.</div>
        </DialogHeader>

        <div className="grid gap-4 text-sm md:grid-cols-[340px_1fr]">
          <div className="space-y-3">
            <div
              className={"rounded-md border border-dashed p-3 transition-colors " + (dragOver ? "border-primary bg-primary/5" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">{busy ? "Reading document…" : "Drop a receipt here, or choose a file."}</div>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="application/pdf,image/*"
                    className="h-8 text-xs"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void extract(f);
                    }}
                  />
                  <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </div>
              {form.sourceFileName && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                  <span className="truncate text-xs">{form.sourceFileName}</span>
                  <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 text-xs" onClick={() => openBillDocument(form.sourceFileName, form.sourceFileData)}>
                    <Eye className="h-3 w-3" /> View
                  </Button>
                </div>
              )}
              {extractSummary && (
                <div className="mt-2 space-y-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-2 text-xs text-emerald-900">
                  <div className="flex items-center gap-1 font-medium">
                    <CheckCircle2 className="h-3 w-3" /> Found in this document
                  </div>
                  <div>
                    {extractSummary.vendor || "Unknown payee"} — {fmtCurrency(extractSummary.amount)}
                    {extractSummary.date ? ` on ${extractSummary.date}` : ""}
                  </div>
                  <div className="text-emerald-800">
                    {extractSummary.propertyMatched ? "Property matched automatically." : "Couldn't match a property — select one to the right."}
                  </div>
                </div>
              )}
              {extractEmpty && (
                <div className="mt-2 flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Couldn't find details in this file — the document is still attached, fill in the fields manually.
                </div>
              )}
              {confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD && (
                <div className="mt-2 flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Low-confidence extraction — double-check every field before saving.
                </div>
              )}
            </div>

            <BillDocumentViewer fileName={form.sourceFileName} fileData={form.sourceFileData} />
          </div>

          <div className="space-y-4">
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Details</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={splitting ? "" : "sm:col-span-2"}>
                  <Field label="Property">
                    <Select value={form.propertyId} onValueChange={(v) => setForm((f) => ({ ...f, propertyId: v }))}>
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
                </div>
                {splitting ? (
                  <Field label="Split with">
                    <div className="flex items-center gap-1">
                      <Select value={form.secondPropertyId} onValueChange={(v) => setForm((f) => ({ ...f, secondPropertyId: v }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Second property" />
                        </SelectTrigger>
                        <SelectContent>
                          {state.properties.filter((p) => p.id !== form.propertyId).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.alias || p.address}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" onClick={() => { setSplitting(false); setForm((f) => ({ ...f, secondPropertyId: "" })); }}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </Field>
                ) : (
                  <div className="flex items-end">
                    <button type="button" className="text-xs text-primary underline" onClick={() => setSplitting(true)}>
                      + Split across a second property
                    </button>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Field label="Payee / vendor">
                    <Input value={form.payee} onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))} />
                  </Field>
                </div>
                <Field label="Reference #">
                  <Input value={form.referenceNumber} onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))} placeholder="Invoice or ref number" />
                </Field>
                <Field label="Date">
                  <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                </Field>
              </div>

              <div>
                <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground" onClick={() => setPeriodOpen((o) => !o)}>
                  {periodOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Add statement period
                </button>
                {periodOpen && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <Field label="Period start">
                      <Input type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />
                    </Field>
                    <Field label="Period end">
                      <Input type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />
                    </Field>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Line items</div>
                <div className="text-xs text-muted-foreground">Net: {fmtCurrency(netTotal)}</div>
              </div>
              {lineItems.map((li) => (
                <div key={li.key} className="space-y-1 border-b pb-2 last:border-0 last:pb-0">
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto_auto] items-end gap-2">
                    <Field label="Description">
                      <Input value={li.description} onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, description: e.target.value } : r)))} />
                    </Field>
                    <Field label="Category">
                      <Select value={li.category} onValueChange={(v) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, category: v as ExpenseCategory } : r)))}>
                        <SelectTrigger>
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
                    </Field>
                    <Field label="Amount">
                      <Input type="number" value={li.amount} onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, amount: e.target.value } : r)))} />
                    </Field>
                    <Field label="GST">
                      <Input type="number" value={li.gst} onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, gst: e.target.value } : r)))} />
                    </Field>
                    <Button
                      size="sm"
                      variant={li.direction === "Income" ? "outline" : "destructive"}
                      className="h-8"
                      onClick={() => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, direction: r.direction === "Income" ? "Expense" : "Income" } : r)))}
                    >
                      {li.direction}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setLineItems((rows) => rows.filter((r) => r.key !== li.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {li.direction === "Expense" && !splitting && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={li.rechargeToTenant}
                        onCheckedChange={(v) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, rechargeToTenant: v === true } : r)))}
                      />
                      <Label className="cursor-pointer text-xs font-normal text-muted-foreground">Recharge to tenant</Label>
                      {li.rechargeToTenant && (
                        <Select value={li.tenantId} onValueChange={(v) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, tenantId: v } : r)))}>
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
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setLineItems((rows) => [...rows, blankLineItem()])}>
                <Plus className="h-3 w-3" /> Add line item
              </Button>
            </div>

            <div>
              <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground" onClick={() => setNotesOpen((o) => !o)}>
                {notesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Add notes
              </button>
              {notesOpen && <Textarea className="mt-2" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
