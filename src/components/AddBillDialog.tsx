import { useEffect, useState } from "react";
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
import { Plus, Trash2, FileUp, AlertTriangle, ChevronDown, ChevronRight, Eye, CheckCircle2, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, todayISO, billTypeToChargeType, ANNUAL_COST_FIELD } from "@/lib/calculations";
import { openBillDocument, base64ToBlob, mimeForFileName, MAX_AI_UPLOAD_BYTES, formatFileSize } from "@/lib/files";
import { downloadPdfAndEmailViaGmail, openGmailCompose } from "@/lib/emailPdf";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import type { BillType, BillLineItem, AiIntakeProposal, BillProposalPayload, Property, Provider } from "@/lib/types";

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
  rechargeToTenant: boolean;
  tenantId: string;
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
  line_items?: { description: string; amount: number }[];
  confidence?: number;
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
 * Rich Add Bill dialog: a document pane (upload/drag-drop, previewed live) alongside a
 * scheduled-payment instalment schedule, provider details (with portal login, which upserts a
 * Provider record rather than living on the bill), and line items. Shared between /bills (no
 * propertyId — full property picker) and a property's Bills tab (propertyId defaulted but still
 * editable, in case the document turns out to be for a different property). Lives in
 * src/components rather than portfolio.tsx because rental.tsx and bills.tsx both need it and must
 * never import from portfolio.tsx.
 */
export function AddBillDialog({
  propertyId: lockedPropertyId,
  initialProposal,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  propertyId?: string;
  /** Pre-fills the form from an already-staged "bill" proposal (Universal Upload's post-upload
   * review) instead of running extract-bill again — the extraction already happened once when
   * the document was classified, no need to pay for a second Gemini call. */
  initialProposal?: AiIntakeProposal;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { state, addBill, addProvider, updateProvider, updateProperty, addInvoice, markProposalApplied, dismissProposal } =
    useStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (o: boolean) => (onOpenChangeProp ? onOpenChangeProp(o) : setInternalOpen(o));
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
    taxCategory: "Immediate Deduction" as "Immediate Deduction" | "Capital Works",
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

  const blankLineItem = (category: BillType = "Water"): LineItemRow => ({
    key: uid("li"),
    description: "",
    category,
    amount: "",
    gst: "",
    rechargeToTenant: false,
    tenantId: "",
  });

  const [form, setForm] = useState(blankForm());
  const [instalments, setInstalments] = useState<InstalmentRow[]>([]);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([blankLineItem()]);

  const reset = () => {
    setForm(blankForm());
    setInstalments([]);
    setLineItems([blankLineItem(form.billType)]);
    setConfidence(null);
    setExtractSummary(null);
    setExtractEmpty(false);
  };

  const netTotal = lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);

  const propertyId = form.propertyId || lockedPropertyId || "";
  const providersForProperty = state.providers.filter((p) => p.propertyId === propertyId);
  const tenantsForProperty = state.tenants.filter((t) => t.propertyId === propertyId);

  /** Fills the form from extracted fields — shared by a fresh "Upload & extract" and by
   * pre-filling from an already-staged proposal below, so the two never drift apart. */
  const applyExtracted = (
    data: Pick<
      ExtractResult,
      "vendor" | "amount" | "due_date" | "property_address" | "bpay_biller_code" | "bpay_reference" | "bill_category" | "future_instalments" | "line_items" | "confidence"
    >,
    sourceFileName?: string,
    sourceFileData?: string,
  ) => {
    const matchedProperty = data.property_address
      ? state.properties.find(
          (p) =>
            p.address.toLowerCase().includes(data.property_address!.toLowerCase()) ||
            data.property_address!.toLowerCase().includes(p.address.toLowerCase()),
        )
      : undefined;

    setForm((f) => ({
      ...f,
      sourceFileName: sourceFileName ?? f.sourceFileName,
      sourceFileData: sourceFileData ?? f.sourceFileData,
      propertyId: lockedPropertyId ?? matchedProperty?.id ?? f.propertyId,
      billType: mapBillType(data.bill_category),
      providerName: data.vendor ?? f.providerName,
      dueDate: data.due_date ?? f.dueDate,
      bpayBillerCode: data.bpay_biller_code ?? f.bpayBillerCode,
      bpayReference: data.bpay_reference ?? f.bpayReference,
      referenceNumber: data.bpay_reference ?? f.referenceNumber,
      hasInstalments: (data.future_instalments?.length ?? 0) > 0,
    }));
    const category = mapBillType(data.bill_category);
    setLineItems(
      data.line_items?.length
        ? data.line_items.map((li) => ({ ...blankLineItem(category), description: li.description, amount: String(li.amount) }))
        : [{ ...blankLineItem(category), description: data.vendor ?? "", amount: data.amount ? String(data.amount) : "" }],
    );
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
    } else {
      setExtractSummary({
        vendor: data.vendor ?? "",
        amount: data.amount ?? 0,
        dueDate: data.due_date ?? "",
        propertyMatched: !!matchedProperty,
        instalmentCount: data.future_instalments?.length ?? 0,
      });
    }
  };

  // Universal Upload already classified+extracted this document once — reuse that result
  // instead of running Gemini again on the same file.
  useEffect(() => {
    if (!initialProposal) return;
    const payload = initialProposal.payload as BillProposalPayload;
    applyExtracted(
      {
        vendor: initialProposal.providerName,
        amount: payload.amount,
        due_date: payload.dueDate,
        property_address: initialProposal.rawPropertyAddress,
        bpay_biller_code: payload.bpayBillerCode,
        bpay_reference: payload.bpayReference,
        bill_category: payload.billCategory,
        future_instalments: payload.futureInstalments?.map((i) => ({ due_date: i.dueDate, amount: i.amount })),
        line_items: payload.lineItems,
        confidence: payload.confidence,
      },
      initialProposal.sourceFileName,
      initialProposal.sourceFileData,
    );
    setForm((f) => ({
      ...f,
      propertyId: initialProposal.propertyId ?? f.propertyId,
      taxCategory: payload.atoCategory,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProposal?.id]);

  const extract = async (file: File) => {
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
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
      // Attach immediately so the document pane shows the file even if extraction fails below.
      setForm((f) => ({ ...f, sourceFileName: file.name, sourceFileData: base64 }));

      const { data, error } = await supabase.functions.invoke<ExtractResult>("extract-bill", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this bill");
        return;
      }

      applyExtracted(data, file.name, base64);

      if (!data.vendor && !data.amount) {
        toast.warning("Couldn't find bill details in this file — the fields below are ready for manual entry");
      } else {
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

  const addInstalment = () =>
    setInstalments((rows) => [
      ...rows,
      { key: uid("inst"), label: `Instalment ${rows.length + 2}`, dueDate: "", amount: "" },
    ]);
  const removeInstalment = (key: string) => setInstalments((rows) => rows.filter((r) => r.key !== key));

  const addLineItem = () => setLineItems((rows) => [...rows, blankLineItem(form.billType)]);
  const removeLineItem = (key: string) => setLineItems((rows) => rows.filter((r) => r.key !== key));

  const emailTenantAboutLineItem = (li: LineItemRow) => {
    const tenant = tenantsForProperty.find((t) => t.id === li.tenantId);
    if (!tenant) return toast.error("Select a tenant for this line item first");
    const amount = parseFloat(li.amount) || 0;
    const property = state.properties.find((p) => p.id === propertyId);
    const subject = `${form.billType} — ${li.description || "usage charge"} (${fmtCurrency(amount)})`;
    const body = `Hi ${tenant.name},\n\nThe ${property?.alias || property?.address || "property"} ${form.billType.toLowerCase()} bill has come in. It includes a usage charge of ${fmtCurrency(amount)} for "${li.description}" that's payable by you under the lease — the full bill is attached for your records.\n\nCould you arrange payment of ${fmtCurrency(amount)} at your earliest convenience?\n\nThanks`;
    if (form.sourceFileData) {
      const blob = base64ToBlob(form.sourceFileData, mimeForFileName(form.sourceFileName));
      downloadPdfAndEmailViaGmail({ blob, fileName: form.sourceFileName || "bill.pdf", to: tenant.email, subject, body });
      toast.success("Bill downloaded — attach it in the Gmail draft that just opened");
    } else {
      openGmailCompose(tenant.email, subject, body);
      toast("No source document on this bill — compose opened without an attachment");
    }
  };

  const save = () => {
    if (!propertyId) return toast.error("Property is required");
    if (!form.providerName.trim()) return toast.error("Provider name is required");
    if (!form.dueDate) return toast.error("Due date is required");
    if (netTotal <= 0) return toast.error("Add at least one line item with an amount");
    if (form.hasInstalments && instalments.some((i) => !i.dueDate || !parseFloat(i.amount))) {
      return toast.error("Every instalment needs a due date and amount");
    }
    if (lineItems.some((li) => li.rechargeToTenant && !li.tenantId)) {
      return toast.error("Select a tenant for every line item flagged to recharge");
    }

    const finalLineItems: BillLineItem[] = lineItems
      .filter((li) => parseFloat(li.amount) > 0)
      .map((li) => {
        const amount = parseFloat(li.amount) || 0;
        const recharge = !!(li.rechargeToTenant && li.tenantId);
        if (recharge) {
          addInvoice({
            tenantId: li.tenantId,
            chargeType: billTypeToChargeType(form.billType),
            amountDue: amount,
            dateIssued: todayISO(),
            dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            status: "Unpaid",
            description: li.description || form.billType,
          });
        }
        return {
          description: li.description || form.billType,
          category: li.category,
          amount,
          gst: li.gst ? parseFloat(li.gst) : undefined,
          rechargeToTenant: li.rechargeToTenant || undefined,
          tenantId: li.rechargeToTenant ? li.tenantId : undefined,
          recharged: recharge || undefined,
        };
      });

    // Bills never create an Expense at intake, from any source -- P&L only ever gets a record
    // once a bill is actually marked Paid (markBillPaid), which posts it using the taxCategory
    // captured below. This applies uniformly whether the bill came from an AI-confirmed
    // proposal or was typed in by hand.
    const payload = initialProposal?.payload as BillProposalPayload | undefined;

    const billGroupId = form.hasInstalments && instalments.length > 0 ? uid("bg") : undefined;
    const shared = {
      propertyId,
      billType: form.billType,
      taxCategory: form.taxCategory,
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
    if (existingProvider) {
      const patch: Partial<Provider> = {};
      if (form.portalUrl) patch.portalUrl = form.portalUrl;
      if (form.portalUsername) patch.portalUsername = form.portalUsername;
      if (form.passwordNote) patch.passwordNote = form.passwordNote;
      // An AI-confirmed bill often carries the vendor's contact details straight off the
      // notice -- fill in whatever the Provider directory doesn't already have, same as the
      // pre-consolidation review card did. Never overwrites a value already on file.
      if (payload) {
        if (!existingProvider.email && payload.vendorEmail) patch.email = payload.vendorEmail;
        if (!existingProvider.phone && payload.vendorPhone) patch.phone = payload.vendorPhone;
        if (!existingProvider.website && payload.vendorWebsite) patch.website = payload.vendorWebsite;
        if (!existingProvider.abn && payload.vendorAbn) patch.abn = payload.vendorAbn;
        if (!existingProvider.address && payload.vendorAddress) patch.address = payload.vendorAddress;
      }
      if (Object.keys(patch).length > 0) updateProvider(existingProvider.id, patch);
    } else {
      addProvider({
        propertyId,
        name: form.providerName.trim(),
        role: payload && form.billType === "Council Rates" ? "Council" : "Other",
        portalUrl: form.portalUrl || undefined,
        portalUsername: form.portalUsername || undefined,
        passwordNote: form.passwordNote || undefined,
        email: payload?.vendorEmail,
        phone: payload?.vendorPhone,
        website: payload?.vendorWebsite,
        abn: payload?.vendorAbn,
        address: payload?.vendorAddress,
      });
    }

    if (initialProposal && payload) {
      const annualField = ANNUAL_COST_FIELD[form.billType];
      if (annualField) {
        let annual: number | null = null;
        if (form.billType === "Insurance" && instalments.length === 0) {
          annual = netTotal;
        } else if (instalments.length === 3) {
          annual = netTotal + instalments.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
        }
        if (annual !== null) {
          updateProperty(propertyId, { [annualField]: Math.round(annual * 100) / 100 } as Partial<Property>);
        }
      }
      markProposalApplied(initialProposal.id);
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
      {!initialProposal && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1">
            <Plus className="h-3 w-3" /> Add Bill
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialProposal ? "Review bill" : "New bill"}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {initialProposal
              ? "Extracted from your upload — review and edit before saving."
              : "Upload a bill for AI extraction, or enter the details manually."}
          </div>
        </DialogHeader>

        <div className="grid gap-4 text-sm md:grid-cols-[340px_1fr]">
          <div className="space-y-3">
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
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {busy ? "Reading document…" : "Drop a bill here, or choose a file."}
                </div>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 gap-1 text-xs"
                    onClick={() => openBillDocument(form.sourceFileName, form.sourceFileData)}
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
                    {extractSummary.propertyMatched ? "Property matched automatically. " : "Couldn't match a property — select one to the right. "}
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

            <BillDocumentViewer fileName={form.sourceFileName} fileData={form.sourceFileData} />
          </div>

          <div className="space-y-4">
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
              <Field label="Tax category">
                <Select
                  value={form.taxCategory}
                  onValueChange={(v) => setForm((f) => ({ ...f, taxCategory: v as typeof f.taxCategory }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Immediate Deduction">Immediate Deduction</SelectItem>
                    <SelectItem value="Capital Works">Capital Works</SelectItem>
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
                <div key={li.key} className="space-y-1 border-b pb-2 last:border-0 last:pb-0">
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-end gap-2">
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
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={li.rechargeToTenant}
                      onCheckedChange={(v) =>
                        setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, rechargeToTenant: v === true } : r)))
                      }
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
                    {li.rechargeToTenant && li.tenantId && (
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => emailTenantAboutLineItem(li)}>
                        <Mail className="h-3 w-3" /> Email tenant
                      </Button>
                    )}
                  </div>
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
        </div>

        <DialogFooter>
          {initialProposal && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  dismissProposal(initialProposal.id);
                  setOpen(false);
                }}
              >
                Dismiss
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Review later
              </Button>
            </>
          )}
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
