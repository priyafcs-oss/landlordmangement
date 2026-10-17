import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/Field";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, FileUp, AlertTriangle, ChevronDown, ChevronRight, Eye, CheckCircle2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  fmtCurrency,
  todayISO,
  billTypeToDefaultCategory,
  mapExpenseCategory,
  expenseCategoryToTaxCategory,
  ANNUAL_COST_FIELD,
  CATEGORY_GROUPS,
} from "@/lib/calculations";
import { extractBill, extractBillFromStored } from "@/lib/billExtract";
import { BillLineItemsEditor } from "@/components/BillLineItemsEditor";
import { blankBillLine, lineWantsRecharge, newlyRechargedLines, planBillLines, type BillLineRow } from "@/lib/billLines";
import { emailTenant, rechargeEmail } from "@/lib/tenantEmails";
import { ProviderPortalLogin } from "@/components/ProviderPortalLogin";
import { extractEmailLinks, linkifySegments, pickBillLink, portalOrigin } from "@/lib/emailLinks";
import { matchPropertyByAddress } from "@/lib/addressMatch";
import {
  openBillDocument,
  MAX_AI_UPLOAD_BYTES,
  formatFileSize,
  readFileAsBase64,
  isSupportedDocumentFile,
  ACCEPTED_DOCUMENT_TYPES_LABEL,
  ACCEPTED_DOCUMENT_TYPES_ACCEPT,
} from "@/lib/files";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { DuplicateWarningDialog } from "@/components/DuplicateWarningDialog";
import { findDuplicateRecord, type DuplicateMatch } from "@/lib/billMatch";
import { matchProviderByName } from "@/lib/providerMatch";
import type { BillType, AiIntakeProposal, BillProposalPayload, Property, Provider, ExpenseCategory, ExtractBillResult } from "@/lib/types";
import { BILL_TYPES, LOW_CONFIDENCE_THRESHOLD, SHARED_UNIT, uid } from "@/lib/constants";



interface InstalmentRow {
  key: string;
  label: string;
  dueDate: string;
  amount: string;
}

function mapBillType(category?: string): BillType {
  const exact = BILL_TYPES.find((t) => t.toLowerCase() === (category ?? "").trim().toLowerCase());
  if (exact) return exact;
  const c = (category ?? "").toLowerCase();
  if (c.includes("land tax")) return "Land Tax";
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
  const {
    state,
    addBill,
    addProvider,
    updateProvider,
    ensureProviderProperty,
    updateProperty,
    addInvoice,
    updateExpense,
    markProposalApplied,
    dismissProposal,
  } = useStore();
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
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(null);
  const [pendingNotify, setPendingNotify] = useState(false);
  // Whether the document pane — and this whole dialog — is enlarged, so "Enlarge" on the source
  // document grows the review window (document + extracted fields together), not just the pane.
  const [docExpanded, setDocExpanded] = useState(false);

  const blankForm = () => ({
    propertyId: lockedPropertyId ?? "",
    unitId: "",
    billType: "Water" as BillType,
    category: billTypeToDefaultCategory("Water") as ExpenseCategory,
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
  const [extractFailed, setExtractFailed] = useState(false);
  const [instalments, setInstalments] = useState<InstalmentRow[]>([]);
  const [lineItems, setLineItems] = useState<BillLineRow[]>([blankBillLine("Water")]);
  // Bumped on every reset() so an extraction still in flight when the dialog is closed/reset can
  // tell its own result is stale and skip applying it, instead of repopulating a "blank" form
  // with a previous, unrelated upload's data once the Gemini call finally resolves.
  const generationRef = useRef(0);

  const reset = () => {
    generationRef.current++;
    setForm(blankForm());
    setInstalments([]);
    setLineItems([blankBillLine(form.billType)]);
    setConfidence(null);
    setExtractSummary(null);
    setExtractEmpty(false);
    setExtractFailed(false);
    setDocExpanded(false);
  };

  const netTotal = lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);
  // A "your bill is ready" email with no PDF — its "View bill" link is the way to the actual bill.
  const emailBillLink = pickBillLink(extractEmailLinks(initialProposal?.sourceEmailBody));
  const emailPortalUrl = emailBillLink ? portalOrigin(emailBillLink.url) : undefined;

  const propertyId = form.propertyId || lockedPropertyId || "";
  const providersForProperty = (() => {
    const taggedIds = new Set(state.providerProperties.filter((pp) => pp.propertyId === propertyId).map((pp) => pp.providerId));
    return state.providers.filter((p) => taggedIds.has(p.id));
  })();
  const tenantsForProperty = state.tenants.filter((t) => t.propertyId === propertyId);
  const propertyUnits = state.properties.find((p) => p.id === propertyId)?.units ?? [];

  /** Fills the form from extracted fields — shared by a fresh "Upload & extract" and by
   * pre-filling from an already-staged proposal below, so the two never drift apart. */
  const applyExtracted = (
    data: Pick<
      ExtractBillResult,
      | "vendor"
      | "amount"
      | "due_date"
      | "property_address"
      | "bpay_biller_code"
      | "bpay_reference"
      | "reference_number"
      | "bill_category"
      | "expense_category"
      | "future_instalments"
      | "line_items"
      | "confidence"
    >,
    sourceFileName?: string,
    sourceFileData?: string,
  ) => {
    const matchedProperty = data.property_address ? matchPropertyByAddress(state.properties, data.property_address) : undefined;

    setForm((f) => ({
      ...f,
      sourceFileName: sourceFileName ?? f.sourceFileName,
      sourceFileData: sourceFileData ?? f.sourceFileData,
      propertyId: lockedPropertyId ?? matchedProperty?.id ?? f.propertyId,
      billType: mapBillType(data.bill_category),
      // expense_category is the richer, purpose-built field for this — bill_category only ever
      // has 7 fixed values (Water/Council/Strata/Insurance/Electricity/Gas/Other), so a repair,
      // pest control, gardening or other non-utility bill always fell back to the generic default
      // when this used billTypeToDefaultCategory(mapBillType(...)) instead.
      category: data.expense_category ? mapExpenseCategory(data.expense_category, data.vendor) : billTypeToDefaultCategory(mapBillType(data.bill_category)),
      providerName: data.vendor ?? f.providerName,
      dueDate: data.due_date ?? f.dueDate,
      bpayBillerCode: data.bpay_biller_code ?? f.bpayBillerCode,
      bpayReference: data.bpay_reference ?? f.bpayReference,
      // reference_number is the invoice/receipt/job number most tradesperson bills carry —
      // bpay_reference only ever applies to a BPAY-payable bill, so it's the fallback, not the
      // primary source.
      referenceNumber: data.reference_number ?? data.bpay_reference ?? f.referenceNumber,
      hasInstalments: (data.future_instalments?.length ?? 0) > 0,
    }));
    const category = mapBillType(data.bill_category);
    setLineItems(
      data.line_items?.length
        ? data.line_items.map((li) => blankBillLine(category, { description: li.description, amount: String(li.amount) }))
        : [blankBillLine(category, { description: data.vendor ?? "", amount: data.amount ? String(data.amount) : "" })],
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
        reference_number: payload.referenceNumber,
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
      // atoCategory is only the coarse two-value AI guess — "Capital Works" nudges toward the
      // Cost Base group over whatever applyExtracted set; otherwise prefer the proposal's own
      // already-resolved category (server-side parse-bill.ts, computed from expense_category)
      // over applyExtracted's weaker billType-derived fallback above.
      category: payload.atoCategory === "Capital Works" ? "Capital Improvement" : (payload.category ?? f.category),
    }));
    // applyExtracted above already ran its own (weaker, client-side substring) property match
    // against the raw extracted address text and stored that guess in extractSummary.propertyMatched
    // — but initialProposal.propertyId is the server's already-resolved match (matchProperty in the
    // edge function, with fuzzier address normalization than the client-side check here), and just
    // overwrote form.propertyId above. Without this, a proposal the server matched correctly but
    // this dialog's own weaker guess couldn't could show "Couldn't match a property" on the left
    // while the correct property sits selected on the right — actively misleading, not just stale.
    if (initialProposal.propertyId) {
      setExtractSummary((s) => (s ? { ...s, propertyMatched: true } : s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProposal?.id]);

  const extract = async (file: File) => {
    if (!isSupportedDocumentFile(file)) {
      return toast.error(`${file.name} isn't a PDF or image — the AI reader (and the preview pane) only support those. Try exporting/saving it as a PDF first.`);
    }
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
    let base64: string;
    try {
      base64 = await readFileAsBase64(file);
    } catch {
      return toast.error(`Couldn't open ${file.name}`);
    }
    // Attach immediately so the document pane shows the file even if extraction fails below.
    setForm((f) => ({ ...f, sourceFileName: file.name, sourceFileData: base64 }));
    await runExtraction(() => extractBill(base64, file.name, file.type || "application/pdf"), file.name, base64);
  };

  /** Shared by a fresh upload and "Read with AI again" on an already-attached file — the AI reader
   * is a Google service that's sometimes overloaded, and a failed read must leave a way to retry
   * without re-uploading (or saving an unread bill). */
  const runExtraction = async (read: () => Promise<ExtractBillResult>, fileName?: string, fileData?: string) => {
    const generation = generationRef.current;
    setBusy(true);
    setExtractSummary(null);
    setExtractEmpty(false);
    setExtractFailed(false);
    try {
      const data = await read();
      if (generationRef.current !== generation) return;
      applyExtracted(data, fileName, fileData);
      if (!data.vendor && !data.amount) {
        toast.warning("Couldn't find bill details in this file — the fields below are ready for manual entry");
      } else {
        toast.success("Extracted — review the fields before saving");
      }
    } catch (e) {
      if (generationRef.current !== generation) return;
      setExtractFailed(true);
      toast.error(e instanceof Error ? e.message : "Couldn't read this bill");
    } finally {
      if (generationRef.current === generation) setBusy(false);
    }
  };

  const rereadAttached = () =>
    runExtraction(() => extractBillFromStored(form.sourceFileName, form.sourceFileData));

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

  const emailTenantAboutLineItem = (li: BillLineRow) => {
    const tenant = tenantsForProperty.find((t) => t.id === li.tenantId);
    const property = state.properties.find((p) => p.id === propertyId);
    return emailTenant(
      tenant,
      rechargeEmail({
        tenantName: tenant?.name ?? "",
        propertyLabel: property?.alias || property?.address,
        billType: form.billType,
        description: li.description,
        amount: parseFloat(li.amount) || 0,
      }),
      { fileName: form.sourceFileName, fileData: form.sourceFileData },
    );
  };

  const attemptSave = (notify: boolean) => {
    if (!propertyId) return toast.error("Property is required");
    if (!form.providerName.trim()) return toast.error("Provider name is required");
    if (!form.dueDate) return toast.error("Due date is required");
    if (netTotal <= 0) return toast.error("Add at least one line item with an amount");
    if (form.hasInstalments && instalments.some((i) => !i.dueDate || !parseFloat(i.amount))) {
      return toast.error("Every instalment needs a due date and amount");
    }
    if (lineItems.some((li) => lineWantsRecharge(form.billType, li) && !li.tenantId)) {
      return toast.error("Select a tenant for every line item flagged to recharge");
    }

    // Runs every save, regardless of entry route (manual, upload, or a staged proposal) — the
    // one thing none of those routes checked for before this existed.
    const match = findDuplicateRecord(state.bills, state.expenses, {
      propertyId,
      vendorOrDescription: form.providerName,
      amount: netTotal,
      date: form.dueDate,
      referenceNumber: form.referenceNumber || undefined,
      bpayReference: form.bpayReference || undefined,
    });
    if (match) {
      setDuplicateMatch(match);
      setPendingNotify(notify);
      return;
    }
    commitSave(notify);
  };

  const commitSave = (notify: boolean) => {
    setDuplicateMatch(null);
    const toNotify = newlyRechargedLines(form.billType, lineItems);
    const { lineItems: finalLineItems, invoices } = planBillLines(lineItems, { billType: form.billType, date: form.issueDate || todayISO() });
    invoices.forEach(addInvoice);

    // Bills never create an Expense at intake, from any source -- P&L only ever gets a record
    // once a bill is actually marked Paid (markBillPaid), which posts it using the taxCategory
    // captured below. This applies uniformly whether the bill came from an AI-confirmed
    // proposal or was typed in by hand.
    const payload = initialProposal?.payload as BillProposalPayload | undefined;

    // Resolved BEFORE the bill(s) below so the created bill(s) can carry providerId themselves —
    // matched portfolio-wide (not just providersForProperty) so a vendor already on file at
    // another property gets tagged onto this one instead of creating a duplicate identity row —
    // same fuzzy word-boundary matching findOrCreateProvider uses, so "Sydney Water" vs "Sydney
    // Water Corporation" across two different bills lands on one directory entry either way.
    const existingProvider = matchProviderByName(state.providers, form.providerName);
    let resolvedProviderId: string | undefined;
    if (existingProvider) {
      resolvedProviderId = existingProvider.id;
      ensureProviderProperty(existingProvider.id, propertyId);
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
      if (!existingProvider.portalUrl && !patch.portalUrl && emailPortalUrl) patch.portalUrl = emailPortalUrl;
      // Same gap-filling idea for the category this vendor is usually filed under — never
      // overwrites a default the landlord (or an earlier bill) already set.
      if (!existingProvider.defaultCategory) patch.defaultCategory = form.category;
      if (Object.keys(patch).length > 0) updateProvider(existingProvider.id, patch);
      if (patch.defaultCategory) toast.success(`${existingProvider.name} — default category set to "${patch.defaultCategory}"`);
    } else {
      resolvedProviderId = addProvider({
        name: form.providerName.trim(),
        role: payload && form.billType === "Council Rates" ? "Council" : "Other",
        portalUrl: form.portalUrl || emailPortalUrl,
        portalUsername: form.portalUsername || undefined,
        passwordNote: form.passwordNote || undefined,
        email: payload?.vendorEmail,
        phone: payload?.vendorPhone,
        website: payload?.vendorWebsite,
        abn: payload?.vendorAbn,
        address: payload?.vendorAddress,
        defaultCategory: form.category,
      });
      ensureProviderProperty(resolvedProviderId, propertyId);
      toast.success(`New provider "${form.providerName.trim()}" — default category set to "${form.category}"`);
    }

    const billGroupId = form.hasInstalments && instalments.length > 0 ? uid("bg") : undefined;
    const shared = {
      propertyId,
      unitId: form.unitId && form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      billType: form.billType,
      category: form.category,
      taxCategory: expenseCategoryToTaxCategory(form.category),
      status: "Unpaid" as const,
      providerName: form.providerName.trim(),
      providerId: resolvedProviderId,
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
      markProposalApplied(initialProposal.id, { propertyId });
    }

    // Notify happens after saving and after the dedup check, using the still-live form state —
    // not before, since the landlord shouldn't be emailing a tenant about a bill that turned out
    // to be a duplicate or that they cancelled partway through.
    if (notify) {
      for (const li of toNotify) void emailTenantAboutLineItem(li);
    }

    setOpen(false);
    reset();
    toast.success(billGroupId ? "Bill added with scheduled instalments" : "Bill added");
  };

  /** Offered on the duplicate-warning dialog when the match is an Expense — the file being saved
   * is very plausibly the actual invoice for a charge already posted from a rent statement (no PDF
   * attached yet), not a genuinely separate second bill. Attaches it there instead of creating a
   * duplicate; if this proposal came from Universal Upload, still marks it applied so it doesn't
   * linger in the review queue. */
  const attachToExisting = () => {
    if (!duplicateMatch || duplicateMatch.kind !== "expense") return;
    updateExpense(duplicateMatch.id, {
      invoiceFileName: form.sourceFileName || undefined,
      invoiceFileData: form.sourceFileData || undefined,
    });
    if (initialProposal) markProposalApplied(initialProposal.id, { propertyId });
    setDuplicateMatch(null);
    setOpen(false);
    reset();
    toast.success("Invoice attached to the existing transaction");
  };

  const hasRecharge = newlyRechargedLines(form.billType, lineItems).length > 0;

  return (
    <>
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
      <DialogContent
        className={
          docExpanded
            ? "flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-y-auto"
            : "max-h-[90vh] max-w-5xl overflow-y-auto"
        }
      >
        <DialogHeader>
          <DialogTitle>{initialProposal ? "Review bill" : "New bill"}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {initialProposal
              ? "Extracted from your upload — review and edit before saving."
              : "Upload a bill for AI extraction, or enter the details manually."}
          </div>
        </DialogHeader>

        <div className={"grid gap-4 text-sm " + (docExpanded ? "flex-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_380px]" : "md:grid-cols-[340px_1fr]")}>
          <div className={"space-y-3 " + (docExpanded ? "overflow-y-auto pr-1" : "")}>
            <div
              className={
                "rounded-md border-2 border-dashed p-6 text-center transition-colors " + (dragOver ? "border-primary bg-primary/5" : "")
              }
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="flex flex-col items-center gap-2">
                <FileUp className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">
                  {busy ? "Reading document…" : "Drop a bill here, or choose a file."}
                </div>
                <div className="text-xs text-muted-foreground">Accepts {ACCEPTED_DOCUMENT_TYPES_LABEL}</div>
                <Input
                  type="file"
                  accept={ACCEPTED_DOCUMENT_TYPES_ACCEPT}
                  className="h-8 max-w-[240px] text-xs"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void extract(f);
                  }}
                />
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
              {form.sourceFileData && (
                <Button
                  size="sm"
                  variant={extractFailed ? "default" : "outline"}
                  className="mt-2 h-7 gap-1 text-xs"
                  disabled={busy}
                  onClick={() => void rereadAttached()}
                >
                  <RefreshCw className={"h-3 w-3" + (busy ? " animate-spin" : "")} />
                  {busy ? "Reading…" : extractFailed ? "Try reading again" : "Read with AI again"}
                </Button>
              )}
              {extractFailed && (
                <div className="mt-2 flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-left text-xs text-amber-800">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  The AI reader failed, but the document is attached. Try again in a minute, or fill in the fields yourself. You can also re-read it later from the saved bill.
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

            {!form.sourceFileData && initialProposal?.sourceEmailBody ? (
              // An emailed "your bill is ready" notice often has no PDF at all — show the email it
              // was read from rather than an empty "No document attached" pane.
              <div className="space-y-1">
                <div className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  No bill PDF came with this email — this is the email it was read from. Drop the PDF above to attach it.
                </div>
                {(emailBillLink || (initialProposal.payload as BillProposalPayload).providerId) && (
                  <ProviderPortalLogin
                    providerId={(initialProposal.payload as BillProposalPayload).providerId}
                    billUrl={emailBillLink?.url}
                  />
                )}
                <pre className="max-h-[420px] min-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-2 font-sans text-xs">
                  {initialProposal.sourceSubject ? `${initialProposal.sourceSubject}\n\n` : ""}
                  {linkifySegments(initialProposal.sourceEmailBody).map((seg, i) =>
                    "url" in seg ? (
                      <a key={i} href={seg.url} target="_blank" rel="noreferrer" className="break-all text-primary underline">
                        {seg.url}
                      </a>
                    ) : (
                      seg.text
                    ),
                  )}
                </pre>
              </div>
            ) : (
              <BillDocumentViewer
                fileName={form.sourceFileName}
                fileData={form.sourceFileData}
                expanded={docExpanded}
                onToggleExpand={() => setDocExpanded((v) => !v)}
              />
            )}
          </div>

          <div className={"space-y-4 " + (docExpanded ? "overflow-y-auto pl-1" : "")}>
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
                        step="0.01"
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
              {propertyUnits.length > 0 && (
                <div className="sm:col-span-2">
                  <Field label="Dwelling">
                    <Select value={form.unitId} onValueChange={(v) => setForm((f) => ({ ...f, unitId: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Shared / whole property" />
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
              <Field label="Category">
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v as ExpenseCategory }))}
                >
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
                    {form.providerName.trim() && !matchProviderByName(providersForProperty, form.providerName) && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">{form.providerName.trim()}</span> is not in your providers yet — saving adds them.
                      </div>
                    )}
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

            <BillLineItemsEditor
              rows={lineItems}
              onChange={setLineItems}
              billType={form.billType}
              tenants={tenantsForProperty}
              propertyId={propertyId}
              hasDocument={!!form.sourceFileData}
              onEmailTenant={emailTenantAboutLineItem}
            />

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
          <Button variant={hasRecharge ? "outline" : "default"} onClick={() => attemptSave(false)} disabled={busy}>
            Save
          </Button>
          {hasRecharge && (
            <Button onClick={() => attemptSave(true)} disabled={busy} className="gap-1">
              <Mail className="h-3.5 w-3.5" /> Save &amp; Notify Tenant
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <DuplicateWarningDialog
      match={duplicateMatch}
      onCancel={() => setDuplicateMatch(null)}
      onSaveAnyway={() => commitSave(pendingNotify)}
      onAttachInstead={duplicateMatch?.kind === "expense" && form.sourceFileData ? attachToExisting : undefined}
    />
    </>
  );
}
