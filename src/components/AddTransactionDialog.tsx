import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/Field";
import { Checkbox } from "@/components/ui/checkbox";
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
import { fmtCurrency, todayISO, CATEGORY_GROUPS, INCOME_CATEGORIES, expenseCategoryToTaxCategory, mapExpenseCategory, fmtModified } from "@/lib/calculations";
import { chargeTypeForCategory, buildRechargeInvoice } from "@/lib/recharge";
import { matchPropertyByAddress } from "@/lib/addressMatch";
import { matchProviderByName } from "@/lib/providerMatch";
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
import { AssessDepreciationDialog } from "@/components/AssessDepreciationDialog";
import { findDuplicateRecord, type DuplicateMatch } from "@/lib/billMatch";
import type { ExpenseCategory, IncomeCategory } from "@/lib/calculations";
import type { AiIntakeProposal, Expense, ExpenseProposalPayload, ExtractBillResult } from "@/lib/types";

const LOW_CONFIDENCE_THRESHOLD = 0.85;
/** How this transaction was recorded — shown read-only next to the title, separate from the
 * invoice/file section below, so "where did this come from" and "what document backs it" are
 * never conflated into one field. */
const EXPENSE_SOURCE_LABELS: Record<Expense["source"], string> = {
  manual: "Manual entry",
  upload: "Uploaded document",
  email_auto: "Email",
  agent_statement: "Agent statement",
};
const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 10);
/** Sentinel for "no specific dwelling" in the Dwelling Select — Radix Select item values can't be
 * an empty string, and shared/whole-property genuinely needs its own selectable option. */
const SHARED_UNIT = "__shared__";

const PRICE_SPIKE_MULTIPLIER = 1.4;

/** Price-spike check only — same shape as the email-bill guardrail's, checked client-side against
 * state.expenses since manual entry has no server round-trip. A flagged line item stages as an
 * "expense" proposal instead of posting straight to Transactions.
 *
 * Duplicate detection used to live here too, but that's now the pre-save DuplicateWarningDialog
 * (findDuplicateRecord) shared with AddBillDialog — a blocking, human-confirmed check run once
 * before save, rather than a silent per-line stage-for-review. */
function checkExpenseGuardrails(
  expenses: { itemName: string; cost: number; date: string }[],
  itemName: string,
  amount: number,
): string | null {
  const name = itemName.trim().toLowerCase();
  const history = expenses.filter((e) => e.itemName.trim().toLowerCase() === name);
  if (history.length > 0) {
    const avg = history.reduce((s, e) => s + Number(e.cost), 0) / history.length;
    if (avg > 0 && amount > avg * PRICE_SPIKE_MULTIPLIER) return "Price Spike Detected";
  }
  return null;
}

interface LineItemRow {
  key: string;
  description: string;
  category: ExpenseCategory | IncomeCategory;
  direction: "Expense" | "Income";
  amount: string;
  gst: string;
  rechargeToTenant: boolean;
  tenantId: string;
  hasWarranty: boolean;
  warrantyExpiry: string;
}

const blankLineItem = (): LineItemRow => ({
  key: uid("li"),
  description: "",
  category: "Sundry Rental Expenses",
  direction: "Expense",
  amount: "",
  gst: "",
  rechargeToTenant: false,
  tenantId: "",
  hasWarranty: false,
  warrantyExpiry: "",
});

/** Switching a line item's direction resets its category to a sensible default for that side —
 * otherwise toggling Income->Expense (or back) could silently save an income-only or
 * expense-only category value that makes no sense for the new direction. */
const defaultCategoryFor = (direction: LineItemRow["direction"]): LineItemRow["category"] =>
  direction === "Income" ? "Other Rental Income" : "Sundry Rental Expenses";

/**
 * Add Transaction — the one-off counterpart to AddBillDialog, same document pane + line-item
 * shape, minus the instalment schedule. Reuses extract-bill for AI extraction (vendor/amount/date
 * overlap enough with a general receipt to be useful, even though that endpoint's prompt is
 * bill-flavoured). Line items can split across up to two properties; each becomes its own Expense
 * row on save, since P&L/Cost Base/Tax Reports read state.expenses as flat single-category rows.
 */
export function AddTransactionDialog({
  propertyId: lockedPropertyId,
  initialProposal,
  expense,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  propertyId?: string;
  /** Pre-fills the form from an already-staged "expense" proposal (a manually-entered
   * transaction the duplicate/price-spike guardrail flagged) instead of losing the original
   * entry — reviewing it here reuses the exact same save path as a fresh entry. */
  initialProposal?: AiIntakeProposal;
  /** Edits an existing Expense in place instead of creating a new one — same document pane +
   * fields as adding, so editing a transaction isn't a stripped-down experience compared to
   * adding one. Locks the form to a single line item on one property (splitting/adding further
   * line items only makes sense when creating something new). */
  expense?: Expense;
  /** Custom open trigger (e.g. an edit-pencil icon button) — falls back to the default "+ Add
   * Transaction" button when omitted and this isn't a proposal review. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const { state, addExpense, updateExpense, addInvoice, addExpenseProposal, markProposalApplied, dismissProposal, findOrCreateProvider } =
    useStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (o: boolean) => (onOpenChangeProp ? onOpenChangeProp(o) : setInternalOpen(o));
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [extractSummary, setExtractSummary] = useState<{ vendor: string; amount: number; date: string; propertyMatched: boolean } | null>(null);
  const [extractEmpty, setExtractEmpty] = useState(false);
  // Whether the document pane(s) — and this whole dialog — are enlarged. Shared by both the
  // source-statement and invoice viewers so either one's "Enlarge" button grows the same dialog.
  const [docExpanded, setDocExpanded] = useState(false);
  // Shown right after the Payee field prefills a line's category from a matched existing
  // provider's defaultCategory — so the auto-fill is visible/undoable rather than a silent trap.
  const [categoryPrefillNote, setCategoryPrefillNote] = useState<string | null>(null);
  const [assessingDepreciation, setAssessingDepreciation] = useState(false);

  const blankForm = () => ({
    propertyId: lockedPropertyId ?? state.properties[0]?.id ?? "",
    secondPropertyId: "",
    unitId: "",
    payee: "",
    referenceNumber: "",
    date: todayISO(),
    periodStart: "",
    periodEnd: "",
    notes: "",
    invoiceFileName: undefined as string | undefined,
    invoiceFileData: undefined as string | undefined,
  });

  const [form, setForm] = useState(blankForm());
  const [lineItems, setLineItems] = useState<LineItemRow[]>([blankLineItem()]);
  const [additionalFiles, setAdditionalFiles] = useState<{ fileName: string; fileData: string }[]>([]);
  // Set once the invoice/receipt file is explicitly removed (rather than just never having been
  // set) — commitEdit needs to tell "clear this on save" apart from "leave it untouched", since
  // sending `undefined` to updateExpense is a no-op (see lib/db.ts's stripUndefined) while `null`
  // actually clears the DB column.
  const [invoiceRemoved, setInvoiceRemoved] = useState(false);
  // The statement/letter this line was originally extracted from (Expense.sourceFileName) — shown
  // read-only (there's no "replace" concept for it here) alongside the invoice above when editing.
  // Only ever populated from an existing expense; a brand-new manual transaction has no statement
  // it was read off, only the invoice/receipt being uploaded for it.
  const [sourceDoc, setSourceDoc] = useState<{ fileName?: string; fileData?: string } | null>(null);
  const [sourceDocRemoved, setSourceDocRemoved] = useState(false);
  // Bumped on every reset() so an extraction still in flight when the dialog is closed/reset can
  // tell its own result is stale and skip applying it, instead of repopulating a "blank" form
  // with a previous, unrelated upload's data once the Gemini call finally resolves.
  const generationRef = useRef(0);

  const reset = () => {
    generationRef.current++;
    setForm(blankForm());
    setLineItems([blankLineItem()]);
    setAdditionalFiles([]);
    setConfidence(null);
    setExtractSummary(null);
    setExtractEmpty(false);
    setSplitting(false);
    setPeriodOpen(false);
    setNotesOpen(false);
    setInvoiceRemoved(false);
    setSourceDoc(null);
    setSourceDocRemoved(false);
    setDocExpanded(false);
  };

  const addAdditionalFile = (file: File) => {
    readFileAsBase64(file)
      .then((base64) => setAdditionalFiles((v) => [...v, { fileName: file.name, fileData: base64 }]))
      .catch(() => toast.error(`Couldn't read ${file.name}`));
  };

  const netTotal = lineItems.reduce((s, li) => s + (li.direction === "Income" ? 1 : -1) * (parseFloat(li.amount) || 0), 0);
  const tenantsForProperty = state.tenants.filter((t) => t.propertyId === form.propertyId);
  const propertyUnits = state.properties.find((p) => p.id === form.propertyId)?.units ?? [];

  /** Fills the form from extracted fields — shared by a fresh "Upload & extract" and by
   * pre-filling from an already-staged proposal below, so the two never drift apart. */
  const applyExtracted = (
    data: Pick<ExtractBillResult, "vendor" | "amount" | "due_date" | "property_address" | "expense_category" | "confidence">,
    invoiceFileName?: string,
    invoiceFileData?: string,
  ) => {
    const matchedProperty = data.property_address ? matchPropertyByAddress(state.properties, data.property_address) : undefined;

    setForm((f) => ({
      ...f,
      invoiceFileName: invoiceFileName ?? f.invoiceFileName,
      invoiceFileData: invoiceFileData ?? f.invoiceFileData,
      propertyId: lockedPropertyId ?? matchedProperty?.id ?? f.propertyId,
      payee: data.vendor ?? f.payee,
      date: data.due_date ?? f.date,
    }));
    setLineItems([
      {
        ...blankLineItem(),
        description: data.vendor ?? "",
        amount: data.amount ? String(data.amount) : "",
        // Previously always left at blankLineItem's hardcoded "Sundry Rental Expenses" default —
        // extract-bill's expense_category field exists specifically so a general receipt/invoice
        // (not just a utility bill) gets a real category guess instead of the generic fallback.
        category: data.expense_category ? mapExpenseCategory(data.expense_category, data.vendor) : blankLineItem().category,
      },
    ]);
    setConfidence(data.confidence ?? null);

    if (!data.vendor && !data.amount) {
      setExtractEmpty(true);
    } else {
      setExtractSummary({
        vendor: data.vendor ?? "",
        amount: data.amount ?? 0,
        date: data.due_date ?? "",
        propertyMatched: !!matchedProperty,
      });
    }
  };

  // Universal Upload's client-side guardrail already flagged this exact entry once — reuse it
  // instead of asking the landlord to re-type or re-upload.
  useEffect(() => {
    if (!initialProposal) return;
    const payload = initialProposal.payload as ExpenseProposalPayload;
    setForm((f) => ({
      ...f,
      payee: payload.itemName ?? f.payee,
      date: payload.date ?? f.date,
      invoiceFileName: initialProposal.sourceFileName ?? f.invoiceFileName,
      invoiceFileData: initialProposal.sourceFileData ?? f.invoiceFileData,
      propertyId: initialProposal.propertyId ?? f.propertyId,
    }));
    setLineItems([
      {
        ...blankLineItem(),
        description: payload.itemName ?? "",
        amount: payload.cost ? String(payload.cost) : "",
        rechargeToTenant: !!payload.rechargeToTenant,
        tenantId: payload.tenantId ?? "",
        hasWarranty: !!payload.hasWarranty,
        warrantyExpiry: payload.warrantyExpiry ?? "",
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProposal?.id]);

  // Editing an existing transaction — pre-fill everything from it, including its own invoice/
  // receipt file (left-pane preview) and any additional files already attached. The statement this
  // line was originally extracted from (if any — e.g. an agent statement or bank/loan statement)
  // is kept separate in sourceDoc: it's a different document from the invoice and was previously
  // silently dropped from this dialog entirely, making it look like a source link had vanished
  // whenever an expense only had a statement and no invoice yet.
  useEffect(() => {
    if (!expense) return;
    setForm((f) => ({
      ...f,
      propertyId: expense.propertyId ?? f.propertyId,
      unitId: expense.unitId ?? f.unitId,
      payee: expense.providerName || expense.itemName,
      referenceNumber: expense.referenceNumber ?? "",
      date: expense.date,
      periodStart: expense.periodStart ?? "",
      periodEnd: expense.periodEnd ?? "",
      notes: expense.notes ?? "",
      invoiceFileName: expense.invoiceFileName ?? undefined,
      invoiceFileData: expense.invoiceFileData ?? undefined,
    }));
    setLineItems([
      {
        key: uid("li"),
        description: expense.itemName,
        category: (expense.category ?? "Sundry Rental Expenses") as ExpenseCategory,
        direction: expense.direction === "Income" ? "Income" : "Expense",
        amount: String(expense.cost),
        gst: expense.gst !== undefined ? String(expense.gst) : "",
        rechargeToTenant: !!expense.rechargeToTenant,
        tenantId: expense.tenantId ?? "",
        hasWarranty: !!expense.hasWarranty,
        warrantyExpiry: expense.warrantyExpiry ?? "",
      },
    ]);
    setAdditionalFiles(expense.additionalFiles ?? []);
    setInvoiceRemoved(false);
    setSourceDoc(expense.sourceFileName ? { fileName: expense.sourceFileName, fileData: expense.sourceFileData ?? undefined } : null);
    setSourceDocRemoved(false);
    if (expense.periodStart || expense.periodEnd) setPeriodOpen(true);
    if (expense.notes) setNotesOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense?.id]);

  const extract = async (file: File) => {
    if (!isSupportedDocumentFile(file)) {
      return toast.error(`${file.name} isn't a PDF or image — the AI reader (and the preview pane) only support those. Try exporting/saving it as a PDF first.`);
    }
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
    const generation = generationRef.current;
    setBusy(true);
    setExtractSummary(null);
    setExtractEmpty(false);
    try {
      const base64 = await readFileAsBase64(file);
      if (generationRef.current !== generation) return;
      setForm((f) => ({ ...f, invoiceFileName: file.name, invoiceFileData: base64 }));
      setInvoiceRemoved(false);

      const { data, error } = await supabase.functions.invoke<ExtractBillResult>("extract-bill", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (generationRef.current !== generation) return;
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this document");
        return;
      }

      applyExtracted(data, file.name, base64);

      if (!data.vendor && !data.amount) {
        toast.warning("Couldn't find details in this file — the fields below are ready for manual entry");
      } else {
        toast.success("Extracted — review the fields before saving");
      }
    } catch (e) {
      if (generationRef.current === generation) toast.error(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      if (generationRef.current === generation) setBusy(false);
    }
  };

  /** Suggests (never forces) a category once the payee matches a known Provider — mirrors the
   * "prefill, not force" behaviour the AI bill pipeline already applies server-side from the same
   * `defaultCategory` field. Only acts when there's a single line item still at its untouched
   * default category, so it can never clobber a choice the landlord already made. */
  const handlePayeeBlur = () => {
    const name = form.payee.trim();
    if (!name) return;
    const matched = matchProviderByName(state.providers, name);
    if (!matched?.defaultCategory) return;
    if (lineItems.length !== 1) return;
    const li = lineItems[0];
    if (li.direction !== "Expense" || li.category !== defaultCategoryFor("Expense")) return;
    setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, category: matched.defaultCategory! } : r)));
    setCategoryPrefillNote(`Prefilled from ${matched.name}'s usual category`);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void extract(f);
  };

  const attemptSave = () => {
    const properties = [form.propertyId, splitting ? form.secondPropertyId : ""].filter(Boolean);
    if (properties.length === 0) return toast.error("Property is required");
    if (!form.payee.trim()) return toast.error("Payee / vendor is required");
    if (netTotal === 0) return toast.error("Add at least one line item with an amount");
    if (lineItems.some((li) => li.rechargeToTenant && !li.tenantId)) {
      return toast.error("Select a tenant for every line item flagged to recharge");
    }

    // Editing skips the duplicate check entirely — it's not a new record being created, and
    // findDuplicateRecord would otherwise just find this very row and flag itself.
    if (expense) return commitEdit();

    const match = findDuplicateRecord(state.bills, state.expenses, {
      propertyId: form.propertyId,
      vendorOrDescription: form.payee,
      amount: netTotal,
      date: form.date,
      referenceNumber: form.referenceNumber || undefined,
    });
    if (match) {
      setDuplicateMatch(match);
      return;
    }
    commitSave();
  };

  /** Locked to exactly one line item on one property — splitting/adding further line items only
   * makes sense when creating something new, not editing an existing single Expense row. */
  const commitEdit = () => {
    if (!expense) return;
    const li = lineItems[0];
    const amount = parseFloat(li.amount) || 0;
    const providerId = form.payee.trim()
      ? findOrCreateProvider(form.payee.trim(), form.propertyId, li.direction === "Expense" ? (li.category as ExpenseCategory) : undefined)
      : undefined;
    if (li.rechargeToTenant && li.tenantId && !expense.recharged) {
      addInvoice(
        buildRechargeInvoice({
          tenantId: li.tenantId,
          chargeType: chargeTypeForCategory(li.category),
          amount,
          date: form.date,
          description: li.description || form.payee,
        }),
      );
    }
    updateExpense(expense.id, {
      itemName: li.description || form.payee,
      cost: amount,
      date: form.date,
      propertyId: form.propertyId,
      unitId: form.unitId && form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      taxCategory: li.direction === "Income" ? "Immediate Deduction" : expenseCategoryToTaxCategory(li.category),
      category: li.category,
      providerName: form.payee.trim() || undefined,
      providerId,
      gst: li.gst ? parseFloat(li.gst) || 0 : undefined,
      direction: li.direction === "Income" ? "Income" : undefined,
      hasWarranty: li.hasWarranty,
      warrantyExpiry: li.hasWarranty ? li.warrantyExpiry || undefined : undefined,
      rechargeToTenant: !!(li.rechargeToTenant && li.tenantId),
      tenantId: li.rechargeToTenant ? li.tenantId : undefined,
      recharged: li.rechargeToTenant && li.tenantId ? true : expense.recharged,
      referenceNumber: form.referenceNumber || undefined,
      periodStart: form.periodStart || undefined,
      periodEnd: form.periodEnd || undefined,
      notes: form.notes || undefined,
      // `null` (not undefined) when explicitly removed, so the DB column actually clears instead
      // of the write being dropped as a no-op — see lib/db.ts's stripUndefined.
      invoiceFileName: invoiceRemoved ? null : form.invoiceFileName,
      invoiceFileData: invoiceRemoved ? null : form.invoiceFileData,
      additionalFiles: additionalFiles.length > 0 ? additionalFiles : null,
      ...(sourceDocRemoved ? { sourceFileName: null, sourceFileData: null } : {}),
    });
    setOpen(false);
    toast.success("Transaction updated");
  };

  const commitSave = () => {
    setDuplicateMatch(null);
    const properties = [form.propertyId, splitting ? form.secondPropertyId : ""].filter(Boolean);
    const validItems = lineItems.filter((li) => parseFloat(li.amount) > 0);
    const perPropertyDivisor = properties.length;
    let flaggedCount = 0;
    // Only pass a default category through to the provider when there's exactly one line item —
    // with several lines (possibly different categories each), a single provider-level default
    // would be a guess, not a fact, so it's left unset rather than picking one arbitrarily.
    const unambiguousCategory =
      validItems.length === 1 && validItems[0].direction === "Expense" ? (validItems[0].category as ExpenseCategory) : undefined;

    for (const propertyId of properties) {
      const providerId = form.payee.trim() ? findOrCreateProvider(form.payee.trim(), propertyId, unambiguousCategory) : undefined;
      for (const li of validItems) {
        const fullAmount = parseFloat(li.amount) || 0;
        const amount = fullAmount / perPropertyDivisor;
        const itemName = li.description || form.payee;

        // Splits and income lines skip the guardrail check — it's scoped to the single-property
        // expense case the email-bill guardrails already cover, not a general fraud check.
        const reviewReason =
          perPropertyDivisor === 1 && li.direction === "Expense"
            ? checkExpenseGuardrails(state.expenses, itemName, amount)
            : null;

        if (reviewReason) {
          flaggedCount++;
          addExpenseProposal({
            propertyId,
            reviewReason,
            payload: {
              itemName,
              cost: amount,
              date: form.date,
              taxCategory: expenseCategoryToTaxCategory(li.category),
              hasWarranty: li.hasWarranty,
              warrantyExpiry: li.hasWarranty ? li.warrantyExpiry || undefined : undefined,
              rechargeToTenant: li.rechargeToTenant || undefined,
              tenantId: li.rechargeToTenant ? li.tenantId : undefined,
            },
            sourceFileName: form.invoiceFileName,
            sourceFileData: form.invoiceFileData,
          });
          continue;
        }

        if (li.rechargeToTenant && li.tenantId && perPropertyDivisor === 1) {
          addInvoice(
            buildRechargeInvoice({
              tenantId: li.tenantId,
              chargeType: chargeTypeForCategory(li.category),
              amount,
              date: form.date,
              description: itemName,
            }),
          );
        }
        addExpense({
          itemName,
          cost: amount,
          date: form.date,
          propertyId,
          unitId: perPropertyDivisor === 1 && form.unitId && form.unitId !== SHARED_UNIT ? form.unitId : undefined,
          taxCategory: li.direction === "Income" ? "Immediate Deduction" : expenseCategoryToTaxCategory(li.category),
          category: li.category,
          providerName: form.payee.trim() || undefined,
          providerId,
          gst: li.gst ? (parseFloat(li.gst) || 0) / perPropertyDivisor : undefined,
          direction: li.direction === "Income" ? "Income" : undefined,
          hasWarranty: li.hasWarranty,
          warrantyExpiry: li.hasWarranty ? li.warrantyExpiry || undefined : undefined,
          rechargeToTenant: !!(li.rechargeToTenant && li.tenantId && perPropertyDivisor === 1),
          tenantId: li.rechargeToTenant && perPropertyDivisor === 1 ? li.tenantId : undefined,
          recharged: li.rechargeToTenant && perPropertyDivisor === 1 ? true : undefined,
          referenceNumber: form.referenceNumber || undefined,
          periodStart: form.periodStart || undefined,
          periodEnd: form.periodEnd || undefined,
          notes: form.notes || undefined,
          status: "approved",
          source: form.invoiceFileData ? "upload" : "manual",
          invoiceFileName: form.invoiceFileName,
          invoiceFileData: form.invoiceFileData,
          additionalFiles: additionalFiles.length > 0 ? additionalFiles : undefined,
        });
      }
    }

    if (initialProposal) markProposalApplied(initialProposal.id, { propertyId: form.propertyId });
    setOpen(false);
    reset();
    if (flaggedCount > 0) {
      toast.success(`Transaction added — ${flaggedCount} line item(s) sent for review (possible duplicate or price spike)`);
    } else {
      toast.success("Transaction added");
    }
  };

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
          {trigger ?? (
            <Button size="sm" className="gap-1">
              <Plus className="h-3 w-3" /> Add Transaction
            </Button>
          )}
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
          <div className="flex items-center gap-2">
            <DialogTitle>{expense ? "Edit transaction" : initialProposal ? "Review transaction" : "New transaction"}</DialogTitle>
            {expense && <Badge variant="secondary">Source: {EXPENSE_SOURCE_LABELS[expense.source]}</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            {expense
              ? "Update the details, or attach/replace the invoice files below."
              : initialProposal
                ? "Flagged for review — check the details before saving."
                : "Upload a receipt for AI extraction, or enter the details manually."}
            {expense && (expense.updatedAt || expense.created_at) && (
              <> · {expense.updatedAt ? `Edited ${fmtModified(expense.updatedAt)}` : `Added ${fmtModified(expense.created_at)}`}</>
            )}
          </div>
        </DialogHeader>

        <div className={"grid gap-4 text-sm " + (docExpanded ? "flex-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_380px]" : "md:grid-cols-[340px_1fr]")}>
          <div className={"space-y-3 " + (docExpanded ? "overflow-y-auto pr-1" : "")}>
            {sourceDoc && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Source statement</div>
                <div className="text-[11px] text-muted-foreground">The document this line was originally read off — not replaced by editing.</div>
                <BillDocumentViewer
                  fileName={sourceDoc.fileName}
                  fileData={sourceDoc.fileData}
                  expanded={docExpanded}
                  onToggleExpand={() => setDocExpanded((v) => !v)}
                  onRemove={() => {
                    setSourceDoc(null);
                    setSourceDocRemoved(true);
                  }}
                />
              </div>
            )}

            <div
              className={"rounded-md border-2 border-dashed p-6 text-center transition-colors " + (dragOver ? "border-primary bg-primary/5" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="flex flex-col items-center gap-2">
                <FileUp className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">{busy ? "Reading document…" : "Drop a receipt here, or choose a file."}</div>
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
              {form.invoiceFileName && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                  <span className="truncate text-xs">{form.invoiceFileName}</span>
                  <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 text-xs" onClick={() => openBillDocument(form.invoiceFileName, form.invoiceFileData)}>
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

            {sourceDoc && <div className="text-xs font-medium text-muted-foreground">Invoice / receipt</div>}
            <BillDocumentViewer
              fileName={form.invoiceFileName}
              fileData={form.invoiceFileData}
              expanded={docExpanded}
              onToggleExpand={() => setDocExpanded((v) => !v)}
              onRemove={
                form.invoiceFileName
                  ? () => {
                      setForm((f) => ({ ...f, invoiceFileName: undefined, invoiceFileData: undefined }));
                      setInvoiceRemoved(true);
                    }
                  : undefined
              }
            />

            <div className="space-y-1 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Additional files / photos</div>
                <label className="cursor-pointer text-xs text-primary underline">
                  + Add file
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) addAdditionalFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {additionalFiles.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  None — the box above is the primary document; add more here if this transaction needs several (e.g.
                  the agent statement that first reported it, plus the actual bill).
                </div>
              ) : (
                <div className="space-y-1">
                  {additionalFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                      <span className="truncate text-xs">{f.fileName}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-6 gap-1 text-xs" onClick={() => openBillDocument(f.fileName, f.fileData)}>
                          <Eye className="h-3 w-3" /> View
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setAdditionalFiles((v) => v.filter((_, j) => j !== i))}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={"space-y-4 " + (docExpanded ? "overflow-y-auto pl-1" : "")}>
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
                ) : propertyUnits.length > 0 ? (
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
                ) : !expense ? (
                  <div className="flex items-end">
                    <button type="button" className="text-xs text-primary underline" onClick={() => setSplitting(true)}>
                      + Split across a second property
                    </button>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <Field label="Payee / vendor">
                    <Input
                      value={form.payee}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, payee: e.target.value }));
                        setCategoryPrefillNote(null);
                      }}
                      onBlur={handlePayeeBlur}
                    />
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
                      <Select
                        value={li.category}
                        onValueChange={(v) => {
                          setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, category: v as LineItemRow["category"] } : r)));
                          setCategoryPrefillNote(null);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {li.direction === "Income"
                            ? INCOME_CATEGORIES.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))
                            : Object.entries(CATEGORY_GROUPS).map(([group, categories]) => (
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
                      onClick={() =>
                        setLineItems((rows) =>
                          rows.map((r) => {
                            if (r.key !== li.key) return r;
                            const direction = r.direction === "Income" ? "Expense" : "Income";
                            return { ...r, direction, category: defaultCategoryFor(direction) };
                          }),
                        )
                      }
                    >
                      {li.direction}
                    </Button>
                    {!expense && (
                      <Button size="icon" variant="ghost" onClick={() => setLineItems((rows) => rows.filter((r) => r.key !== li.key))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {categoryPrefillNote && lineItems.length === 1 && (
                    <div className="text-[11px] text-muted-foreground">{categoryPrefillNote}</div>
                  )}
                  {li.direction === "Expense" && !splitting && (
                    <div className="flex flex-wrap items-center gap-2">
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
                      <Checkbox
                        checked={li.hasWarranty}
                        onCheckedChange={(v) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, hasWarranty: v === true } : r)))}
                      />
                      <Label className="cursor-pointer text-xs font-normal text-muted-foreground">Has warranty</Label>
                      {li.hasWarranty && (
                        <Input
                          type="date"
                          value={li.warrantyExpiry}
                          onChange={(e) => setLineItems((rows) => rows.map((r) => (r.key === li.key ? { ...r, warrantyExpiry: e.target.value } : r)))}
                          className="h-7 w-[150px] text-xs"
                          title="Warranty expiry"
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!expense && (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setLineItems((rows) => [...rows, blankLineItem()])}>
                  <Plus className="h-3 w-3" /> Add line item
                </Button>
              )}
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
          {expense && expense.direction !== "Income" && (
            <Button variant="outline" onClick={() => setAssessingDepreciation(true)}>
              Assess depreciation
            </Button>
          )}
          <Button onClick={attemptSave} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <DuplicateWarningDialog match={duplicateMatch} onCancel={() => setDuplicateMatch(null)} onSaveAnyway={commitSave} />
    <AssessDepreciationDialog expense={assessingDepreciation ? (expense ?? null) : null} onClose={() => setAssessingDepreciation(false)} />
    </>
  );
}
