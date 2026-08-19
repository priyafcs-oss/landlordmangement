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
import { Plus, Trash2, FileUp, AlertTriangle, ChevronDown, ChevronRight, Eye, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import type { BillType, BillLineItem } from "@/lib/types";

const BILL_TYPES: BillType[] = ["Water", "Council Rates", "Strata", "Insurance", "Electricity", "Gas", "Other"];
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

interface InstalmentRow {
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
}

interface ExtractResult {
  ok?: boolean;
  error?: string;
  vendor?: string;
  amount?: number;
  due_date?: string;
  property_address?: string;
  bpay_biller_code?: string | null;
  bpay_reference?: string | null;
  bill_category?: string;
  future_instalments?: { due_date: string; amount: number }[];
  confidence?: number;
}

const IMAGE_EXT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function openDataUrl(fileName: string | undefined, base64: string | undefined) {
  if (!base64) return;
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  const mime = IMAGE_EXT_MIME[ext] ?? "application/pdf";
  window.open(`data:${mime};base64,${base64}`, "_blank");
}

function mapBillType(category?: string): BillType {
  const exact = BILL_TYPES.find((t) => t.toLowerCase() === (category ?? "").trim().toLowerCase());
  if (exact) return exact;
  const c = (category ?? "").toLowerCase();
  if (c.includes("council") || c.includes("rates")) return "Council Rates";
  if (c.includes("water")) return "Water";
  if (c.includes("strata")) return "Strata";
  if (c.includes("insur")) return "Insurance";
  if (c.includes("electric") || c.includes("power")) return "Electricity";
  if (c.includes("gas")) return "Gas";
  return "Other";
}

/**
 * Rich Add Bill dialog: upload-and-extract, a "scheduled payments" instalment schedule, provider
 * details (with portal login, which upserts a Provider record rather than living on the bill), and
 * line items. Shared between /bills (no propertyId — full property picker) and a property's Bills
 * tab (propertyId locked). Lives in src/components rather than portfolio.tsx because rental.tsx and
 * bills.tsx both need it and must never import from portfolio.tsx.
 */
export function AddBillDialog({ propertyId: lockedPropertyId }: { propertyId?: string }) {
  const { state, addBill, addProvider, updateProvider } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [extractSummary, setExtractSummary] = useState<{
    vendor: string;
    amount: number;
    dueDate: string;
    propertyMatched: boolean;
    instalmentCount: number;
  } | null>(null);
  const [extractEmpty, setExtractEmpty] = useState(false);

  const blankForm = () => ({
    propertyId: lockedPropertyId ?? "",
    billType: "Water" as BillType,
    providerName: "",
    portalUrl: "",
    portalUsername: "",
    passwordNote: "",
    referenceNumber: "",
    issueDate: "",
    dueDate: todayISO(),
    bpayBillerCode: "",
    bpayReference: "",
    periodStart: "",
    periodEnd: "",
    notes: "",
    hasInstalments: false,
    sourceFileName: undefined as string | undefined,
    sourceFileData: undefined as string | undefined,
  });

  const [form, setForm] = useState(blankForm());
  const [instalments, setInstalments] = useState<InstalmentRow[]>([]);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([
    { key: uid("li"), description: "", category: "Water", amount: "", gst: "" },
  ]);

  const reset = () => {
    setForm(blankForm());
    setInstalments([]);
    setLineItems([{ key: uid("li"), description: "", category: form.billType, amount: "", gst: "" }]);
    setConfidence(null);
    setExtractSummary(null);
    setExtractEmpty(false);
  };

  const netTotal = lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);

  const providersForProperty = state.providers.filter((p) => p.propertyId === (form.propertyId || lockedPropertyId));

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
      const { data, error } = await supabase.functions.invoke<ExtractResult>("extract-bill", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this bill");
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
        propertyId: lockedPropertyId ?? matchedProperty?.id ?? f.propertyId,
        billType: mapBillType(data.bill_category),
        providerName: data.vendor ?? f.providerName,
        dueDate: data.due_date ?? f.dueDate,
        bpayBillerCode: data.bpay_biller_code ?? f.bpayBillerCode,
        bpayReference: data.bpay_reference ?? f.bpayReference,
        referenceNumber: data.bpay_reference ?? f.referenceNumber,
        hasInstalments: (data.future_instalments?.length ?? 0) > 0,
        sourceFileName: file.name,
        sourceFileData: base64,
      }));
      setLineItems([
        {
          key: uid("li"),
          description: data.vendor ?? "",
          category: mapBillType(data.bill_category),
          amount: data.amount ? String(data.amount) : "",
          gst: "",
        },
      ]);
      if (data.future_instalments?.length) {
        setInstalments(
          data.future_instalments.map((i, idx) => ({
            key: uid("inst"),
            label: `Instalment ${idx + 2}`,
            dueDate: i.due_date,
            amount: String(i.amount),
          })),
        );
      }
      setConfidence(data.confidence ?? null);

      if (!data.vendor && !data.amount) {
        setExtractEmpty(true);
        toast.warning("Couldn't find bill details in this file — the fields below are ready for manual entry");
      } else {
        setExtractSummary({
          vendor: data.vendor ?? "",
          amount: data.amount ?? 0,
          dueDate: data.due_date ?? "",
          propertyMatched: !!matchedProperty,
          instalmentCount: data.future_instalments?.length ?? 0,
        });
        toast.success("Extracted — review the fields below before saving");
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

  const addInstalment = () =>
    setInstalments((rows) => [
      ...rows,
      { key: uid("inst"), label: `Instalment ${rows.length + 2}`, dueDate: "", amount: "" },
    ]);
  const removeInstalment = (key: string) => setInstalments((rows) => rows.filter((r) => r.key !== key));

  const addLineItem = () =>
    setLineItems((rows) => [...rows, { key: uid("li"), description: "", category: form.billType, amount: "", gst: "" }]);
  const removeLineItem = (key: string) => setLineItems((rows) => rows.filter((r) => r.key !== key));

  const save = () => {
    const propertyId = lockedPropertyId ?? form.propertyId;
    if (!propertyId) return toast.error("Property is required");
    if (!form.providerName.trim()) return toast.error("Provider name is required");
    if (!form.dueDate) return toast.error("Due date is required");
    if (netTotal <= 0) return toast.error("Add at least one line item with an amount");
    if (form.hasInstalments && instalments.some((i) => !i.dueDate || !parseFloat(i.amount))) {
      return toast.error("Every instalment needs a due date and amount");
    }

    const finalLineItems: BillLineItem[] = lineItems
      .filter((li) => parseFloat(li.amount) > 0)
      .map((li) => ({
        description: li.description || form.billType,
        category: li.category,
        amount: parseFloat(li.amount) || 0,
        gst: li.gst ? parseFloat(li.gst) : undefined,
      }));

    const billGroupId = form.hasInstalments && instalments.length > 0 ? uid("bg") : undefined;
    const shared = {
      propertyId,
      billType: form.billType,
      status: "Unpaid" as const,
      providerName: form.providerName.trim(),
      referenceNumber: form.referenceNumber || undefined,
      bpayBillerCode: form.bpayBillerCode || undefined,
      bpayReference: form.bpayReference || undefined,
      issueDate: form.issueDate || undefined,
      periodStart: form.periodStart || undefined,
      periodEnd: form.periodEnd || undefined,
      lineItems: finalLineItems,
      notes: form.notes || undefined,
      sourceFileName: form.sourceFileName,
      sourceFileData: form.sourceFileData,
      source: (form.sourceFileData ? "Upload" : "Manual") as "Upload" | "Manual",
      billGroupId,
    };

    addBill({
      ...shared,
      amount: netTotal,
      dueDate: form.dueDate,
      label: billGroupId ? "Instalment 1" : undefined,
    });
    if (billGroupId) {
      for (const inst of instalments) {
        addBill({
          ...shared,
          amount: parseFloat(inst.amount) || 0,
          dueDate: inst.dueDate,
          label: inst.label,
        });
      }
    }

    const existingProvider = providersForProperty.find(
      (p) => p.name.trim().toLowerCase() === form.providerName.trim().toLowerCase(),
    );
    const providerPatch = {
      portalUrl: form.portalUrl || undefined,
      portalUsername: form.portalUsername || undefined,
      passwordNote: form.passwordNote || undefined,
    };
    if (existingProvider) {
      if (form.portalUrl || form.portalUsername || form.passwordNote) {
        updateProvider(existingProvider.id, providerPatch);
      }
    } else {
      addProvider({ propertyId, name: form.providerName.trim(), role: "Other", ...providerPatch });
    }

    setOpen(false);
    reset();
    toast.success(billGroupId ? "Bill added with scheduled instalments" : "Bill added");
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
          <Plus className="h-3 w-3" /> Add Bill
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New bill</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div
            className={
              "rounded-md border border-dashed p-3 transition-colors " + (dragOver ? "border-primary bg-primary/5" : "")
            }
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {busy ? "Reading document…" : "Drop a bill here, or choose a file — the fields below get pre-filled."}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept="application/pdf,image/*"
                  className="h-8 w-[220px] text-xs"
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
                <span className="text-xs">Attached: {form.sourceFileName}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 text-xs"
                  onClick={() => openDataUrl(form.sourceFileName, form.sourceFileData)}
                >
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
                  {extractSummary.vendor || "Unknown vendor"} — {fmtCurrency(extractSummary.amount)}
                  {extractSummary.dueDate ? ` due ${extractSummary.dueDate}` : ""}
                </div>
                <div className="text-emerald-800">
                  {extractSummary.propertyMatched ? "Property matched automatically. " : "Couldn't match a property — select one below. "}
                  {extractSummary.instalmentCount > 0
                    ? `${extractSummary.instalmentCount} future instalment(s) added.`
                    : "No future instalments found."}
                </div>
              </div>
            )}
            {extractEmpty && (
              <div className="mt-2 flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Couldn't find bill details in this file — the document is still attached, fill in the fields manually.
              </div>
            )}
            {confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD && (
              <div className="mt-2 flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Low-confidence extraction — double-check every field before saving.
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-md border p-2">
            <Checkbox
              checked={form.hasInstalments}
              onCheckedChange={(v) => setForm((f) => ({ ...f, hasInstalments: v === true }))}
            />
            <Label className="cursor-pointer text-xs" onClick={() => setForm((f) => ({ ...f, hasInstalments: !f.hasInstalments }))}>
              This bill has scheduled payments (future instalments)
            </Label>
          </div>

          {form.hasInstalments && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Payment plan</div>
              {instalments.map((inst) => (
                <div key={inst.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <Field label="Label">
                    <Input
                      value={inst.label}
                      onChange={(e) =>
                        setInstalments((rows) => rows.map((r) => (r.key === inst.key ? { ...r, label: e.target.value } : r)))
                      }
                    />
                  </Field>
                  <Field label="Due date">
                    <Input
                      type="date"
                      value={inst.dueDate}
                      onChange={(e) =>
                        setInstalments((rows) => rows.map((r) => (r.key === inst.key ? { ...r, dueDate: e.target.value } : r)))
                      }
                    />
                  </Field>
                  <Field label="Amount">
                    <Input
                      type="number"
                      value={inst.amount}
                      onChange={(e) =>
                        setInstalments((rows) => rows.map((r) => (r.key === inst.key ? { ...r, amount: e.target.value } : r)))
                      }
                    />
                  </Field>
                  <Button size="icon" variant="ghost" onClick={() => removeInstalment(inst.key)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="gap-1" onClick={addInstalment}>
                <Plus className="h-3 w-3" /> Add payment
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {!lockedPropertyId && (
              <div className="sm:col-span-2">
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
            )}
            <Field label="Bill type">
              <Select value={form.billType} onValueChange={(v) => setForm((f) => ({ ...f, billType: v as BillType }))}>
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
            <Field label="Reference #">
              <Input value={form.referenceNumber} onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))} />
            </Field>
            <Field label="Issue date">
              <Input type="date" value={form.issueDate} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} />
            </Field>
            <Field label="Due date">
              <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
            </Field>
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

          <div className="space-y-2 rounded-md border p-3">
            <div className="text-xs font-medium">Provider information</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Provider name">
                  <Input
                    list="add-bill-providers"
                    value={form.providerName}
                    onChange={(e) => {
                      const name = e.target.value;
                      const match = providersForProperty.find((p) => p.name.toLowerCase() === name.toLowerCase());
                      setForm((f) => ({
                        ...f,
                        providerName: name,
                        portalUrl: match?.portalUrl ?? f.portalUrl,
                        portalUsername: match?.portalUsername ?? f.portalUsername,
                        passwordNote: match?.passwordNote ?? f.passwordNote,
                      }));
                    }}
                  />
                  <datalist id="add-bill-providers">
                    {providersForProperty.map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                  </datalist>
                </Field>
              </div>
              <Field label="Portal URL">
                <Input value={form.portalUrl} onChange={(e) => setForm((f) => ({ ...f, portalUrl: e.target.value }))} placeholder="https://…" />
              </Field>
              <Field label="Portal username">
                <Input value={form.portalUsername} onChange={(e) => setForm((f) => ({ ...f, portalUsername: e.target.value }))} />
              </Field>
              <Field label="Password note">
                <Input value={form.passwordNote} onChange={(e) => setForm((f) => ({ ...f, passwordNote: e.target.value }))} />
              </Field>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium">Line items</div>
              <div className="text-xs text-muted-foreground">Net: {fmtCurrency(netTotal)}</div>
            </div>
            {lineItems.map((li) => (
              <div key={li.key} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-end gap-2">
                <Field label="Description">
                  <Input
                    value={li.description}
                    onChange={(e) =>
                      setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, description: e.target.value } : r)))
                    }
                  />
                </Field>
                <Field label="Category">
                  <Select
                    value={li.category}
                    onValueChange={(v) =>
                      setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, category: v as BillType } : r)))
                    }
                  >
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
                  <Input
                    type="number"
                    value={li.amount}
                    onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, amount: e.target.value } : r)))}
                  />
                </Field>
                <Field label="GST">
                  <Input
                    type="number"
                    value={li.gst}
                    onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, gst: e.target.value } : r)))}
                  />
                </Field>
                <Button size="icon" variant="ghost" onClick={() => removeLineItem(li.key)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="gap-1" onClick={addLineItem}>
              <Plus className="h-3 w-3" /> Add line item
            </Button>
          </div>

          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground"
              onClick={() => setNotesOpen((o) => !o)}
            >
              {notesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Add notes
            </button>
            {notesOpen && (
              <Textarea
                className="mt-2"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            )}
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
