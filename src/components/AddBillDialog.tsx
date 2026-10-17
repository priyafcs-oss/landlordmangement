import { useEffect, useState } from "react";
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
import { Plus, ChevronDown, ChevronRight, CheckCircle2, Mail } from "lucide-react";
import { toast } from "sonner";
import {
  fmtCurrency,
  todayISO,
  billTypeToDefaultCategory,
  mapExpenseCategory,
  expenseCategoryToTaxCategory,
  ANNUAL_COST_FIELD,
  CATEGORY_GROUPS,
  mapBillType,
} from "@/lib/calculations";
import { useAiExtraction } from "@/lib/useAiExtraction";
import { DocumentDropzone } from "@/components/DocumentDropzone";
import { BillLineItemsEditor } from "@/components/BillLineItemsEditor";
import { InstalmentScheduleEditor } from "@/components/InstalmentScheduleEditor";
import { instalmentBills, instalmentLabel, newInstalmentRow, validateInstalments, type InstalmentRow } from "@/lib/instalments";
import { blankBillLine, lineWantsRecharge, newlyRechargedLines, planBillLines, type BillLineRow } from "@/lib/billLines";
import { emailTenant, rechargeEmail } from "@/lib/tenantEmails";
import { ProviderPortalLogin } from "@/components/ProviderPortalLogin";
import { extractEmailLinks, linkifySegments, pickBillLink, portalOrigin } from "@/lib/emailLinks";
import { matchPropertyByAddress } from "@/lib/addressMatch";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { useDuplicateGuard } from "@/components/DuplicateWarningDialog";
import { matchProviderByName } from "@/lib/providerMatch";
import type { BillType, AiIntakeProposal, BillProposalPayload, Property, ExpenseCategory, ExtractBillResult } from "@/lib/types";
import { BILL_TYPES, SHARED_UNIT, uid } from "@/lib/constants";
import { documentLayout } from "@/lib/documentLayout";




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
    findOrCreateProvider,
    updateProperty,
    addInvoice,
    markProposalApplied,
    dismissProposal,
  } = useStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  // Every close resets the form, however it closes (X, Dismiss, Review later, Save) — the same
  // rule AddTransactionDialog uses — and the hydrate effect below refills it on every open.
  const setOpen = (o: boolean) => {
    if (!o) reset();
    if (onOpenChangeProp) onOpenChangeProp(o);
    else setInternalOpen(o);
  };
  const [confidence, setConfidence] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [extractSummary, setExtractSummary] = useState<{
    vendor: string;
    amount: number;
    dueDate: string;
    propertyMatched: boolean;
    instalmentCount: number;
  } | null>(null);
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
  const [instalments, setInstalments] = useState<InstalmentRow[]>([]);
  const [lineItems, setLineItems] = useState<BillLineRow[]>([blankBillLine("Water")]);
  const reset = () => {
    reading.reset();
    setForm(blankForm());
    setInstalments([]);
    setLineItems([blankBillLine(form.billType)]);
    setConfidence(null);
    setExtractSummary(null);
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
      billType: mapBillType(data.bill_category, data.vendor),
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
    const category = mapBillType(data.bill_category, data.vendor);
    setLineItems(
      data.line_items?.length
        ? data.line_items.map((li) => blankBillLine(category, { description: li.description, amount: String(li.amount) }))
        : [blankBillLine(category, { description: data.vendor ?? "", amount: data.amount ? String(data.amount) : "" })],
    );
    if (data.future_instalments?.length) {
      setInstalments(
        data.future_instalments.map((i, idx) => newInstalmentRow(idx + 2, { dueDate: i.due_date, amount: String(i.amount) })),
      );
    }
    setConfidence(data.confidence ?? null);

    setExtractSummary(null);
    if (data.vendor || data.amount) {
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
  // Runs on every open, not just when the proposal changes: the dialog stays mounted in its list
  // row, so closing (which resets) then reopening the same proposal used to show a blank form.
  useEffect(() => {
    if (!initialProposal || !open) return;
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
  }, [open, initialProposal?.id]);

  // A fresh upload, or "Read with AI again" on the attached file (a proposal's stored PDF, a
  // failed read) — the shared upload → read → fill flow every upload dialog uses.
  const reading = useAiExtraction<ExtractBillResult>({
    fn: "extract-bill",
    fallbackError: "Couldn't read this bill",
    onAttach: (sourceFileName, sourceFileData) => setForm((f) => ({ ...f, sourceFileName, sourceFileData })),
    emptyMessage: "Couldn't find bill details in this file — the fields below are ready for manual entry",
    apply: (data) => {
      applyExtracted(data);
      return { empty: !data.vendor && !data.amount };
    },
  });
  const busy = reading.busy;

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
        landlordName: state.landlordProfile.fullName,
      }),
      { fileName: form.sourceFileName, fileData: form.sourceFileData },
    );
  };

  const attemptSave = (notify: boolean) => {
    if (!propertyId) return toast.error("Property is required");
    if (!form.providerName.trim()) return toast.error("Provider name is required");
    if (!form.dueDate) return toast.error("Due date is required");
    if (netTotal <= 0) return toast.error("Add at least one line item with an amount");
    const scheduleError = form.hasInstalments ? validateInstalments(instalments) : null;
    if (scheduleError) return toast.error(scheduleError);
    if (lineItems.some((li) => lineWantsRecharge(form.billType, li) && !li.tenantId)) {
      return toast.error("Select a tenant for every line item flagged to recharge");
    }

    // Runs every save, regardless of entry route (manual, upload, or a staged proposal) — the
    // one thing none of those routes checked for before this existed.
    setPendingNotify(notify);
    const duplicate = duplicates.guard({
      propertyId,
      vendorOrDescription: form.providerName,
      amount: netTotal,
      date: form.dueDate,
      referenceNumber: form.referenceNumber || undefined,
      bpayReference: form.bpayReference || undefined,
    });
    if (!duplicate) commitSave(notify);
  };

  const commitSave = (notify: boolean) => {
    const toNotify = newlyRechargedLines(form.billType, lineItems);
    const { lineItems: finalLineItems, invoices } = planBillLines(lineItems, { billType: form.billType, date: form.issueDate || todayISO() });
    invoices.forEach(addInvoice);

    // Bills never create an Expense at intake, from any source -- P&L only ever gets a record
    // once a bill is actually marked Paid (markBillPaid), which posts it using the taxCategory
    // captured below. This applies uniformly whether the bill came from an AI-confirmed
    // proposal or was typed in by hand.
    const payload = initialProposal?.payload as BillProposalPayload | undefined;

    // Resolved before the bill(s) below so they carry providerId. The store's shared
    // find-or-create matches portfolio-wide (ABN, exact name, word tokens), tags the provider to
    // this property, applies the portal login typed here, and fills in contact details read off
    // the notice only where the directory has none.
    const resolvedProviderId = findOrCreateProvider(form.providerName, propertyId, form.category, {
      abn: payload?.vendorAbn,
      role: payload && form.billType === "Council Rates" ? "Council" : undefined,
      set: { portalUrl: form.portalUrl || undefined, portalUsername: form.portalUsername || undefined, passwordNote: form.passwordNote || undefined },
      fillGaps: {
        email: payload?.vendorEmail,
        phone: payload?.vendorPhone,
        website: payload?.vendorWebsite,
        abn: payload?.vendorAbn,
        address: payload?.vendorAddress,
        portalUrl: emailPortalUrl,
      },
    });

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
      label: billGroupId ? instalmentLabel(1) : undefined,
    });
    if (billGroupId) instalmentBills(shared, instalments, billGroupId).forEach(addBill);

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
    toast.success(billGroupId ? "Bill added with scheduled instalments" : "Bill added");
  };

  const duplicates = useDuplicateGuard({
    onSaveAnyway: () => commitSave(pendingNotify),
    file: { fileName: form.sourceFileName, fileData: form.sourceFileData },
    proposalId: initialProposal?.id,
    propertyId,
    onAttached: () => setOpen(false),
  });

  const layout = documentLayout(docExpanded);
  const hasRecharge = newlyRechargedLines(form.billType, lineItems).length > 0;

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      {!initialProposal && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1">
            <Plus className="h-3 w-3" /> Add Bill
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className={layout.dialog}
      >
        <DialogHeader>
          <DialogTitle>{initialProposal ? "Review bill" : "New bill"}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {initialProposal
              ? "Extracted from your upload — review and edit before saving."
              : "Upload a bill for AI extraction, or enter the details manually."}
          </div>
        </DialogHeader>

        <div className={layout.grid}>
          <div className={"space-y-3 " + layout.left}>
            <DocumentDropzone
              prompt="Drop a bill here, or choose a file."
              busy={reading.busy}
              status={reading.status}
              fileName={form.sourceFileName}
              fileData={form.sourceFileData}
              onFile={(f) => void reading.extract(f)}
              onReread={() => void reading.reread(form.sourceFileName, form.sourceFileData)}
              emptyText="Couldn't find bill details in this file — the document is still attached, fill in the fields manually."
              confidence={confidence}
            >
              {extractSummary && reading.status !== "failed" && (
                <div className="mt-2 space-y-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-2 text-left text-xs text-emerald-900">
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
            </DocumentDropzone>

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

          <div className={"space-y-4 " + layout.right}>
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
                <InstalmentScheduleEditor rows={instalments} onChange={setInstalments} numberOffset={1} addLabel="Add payment" />
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
                    {form.providerName.trim() && !matchProviderByName(state.providers, form.providerName) && (
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
    {duplicates.dialog}
    </>
  );
}
