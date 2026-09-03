import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { Switch } from "@/components/ui/switch";
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
import { Plus, Trash2, FileUp, AlertTriangle, Eye, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { openBillDocument, MAX_AI_UPLOAD_BYTES, formatFileSize, readFileAsBase64 } from "@/lib/files";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import type { Loan } from "@/lib/types";

interface ExtractResult {
  ok?: boolean;
  error?: string;
  lender_name?: string;
  loan_amount?: number | null;
  interest_rate?: number | null;
  monthly_repayment?: number | null;
  start_date?: string | null;
  maturity_date?: string | null;
  next_repayment_date?: string | null;
  product_type?: string | null;
  bsb?: string | null;
  account_number?: string | null;
  has_offset_account?: boolean | null;
  confidence?: number;
}

/**
 * Manual Add/Edit Loan — previously the only way a Loan record ever came into existence was an
 * AI-parsed loan-document proposal reviewed elsewhere; there was no way to just type one in, and
 * no way to upload-and-extract from this dialog itself (unlike Add Bill/Transaction/Depreciation
 * Report). Adding a new loan now follows that same shape: drop in the offer/contract/approval
 * letter to pre-fill the fields below via Gemini (extract-loan-document, the same prompt/schema
 * the email-ingestion pipeline uses), or just type them in — either way, one form, one Save.
 * The document pane is create-only; editing an existing loan (which may already have statement
 * history) stays the plain manual form it always was.
 */
export function AddLoanDialog({
  loan,
  propertyId: lockedPropertyId,
  trigger,
}: {
  /** Edits an existing Loan in place instead of creating a new one. */
  loan?: Loan;
  /** Pre-fills and locks the property when adding from a property-scoped page (e.g. the
   * property's own Loans tab) — omit for the portfolio-wide Loans summary, where the landlord
   * picks the property themselves. */
  propertyId?: string;
  trigger?: React.ReactNode;
}) {
  const { state, addLoan, updateLoan, deleteLoan } = useStore();
  const [open, setOpen] = useState(false);
  const isEdit = !!loan;
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [extractOk, setExtractOk] = useState(false);
  const [extractEmpty, setExtractEmpty] = useState(false);
  const [docExpanded, setDocExpanded] = useState(false);
  // Bumped on every reset so an extraction still in flight when the dialog is closed can tell
  // its own result is stale and skip applying it — same pattern as Add Bill/Transaction/
  // Depreciation Report.
  const generationRef = useRef(0);

  const blankForm = () => ({
    propertyId: loan?.propertyId ?? lockedPropertyId ?? state.properties[0]?.id ?? "",
    bankName: loan?.bankName ?? "",
    bsb: loan?.bsb ?? "",
    accountNumber: loan?.accountNumber ?? "",
    productType: loan?.productType ?? "",
    loanType: (loan?.loanType ?? "Principal & Interest") as Loan["loanType"],
    purpose: (loan?.purpose ?? "Investment") as Loan["purpose"],
    originalAmount: loan?.originalAmount !== undefined ? String(loan.originalAmount) : "",
    totalBalance: loan ? String(loan.totalBalance) : "",
    creditLimit: loan?.creditLimit !== undefined ? String(loan.creditLimit) : "",
    interestRate: loan ? String(loan.interestRate) : "",
    rateType: (loan?.rateType ?? "Variable") as Loan["rateType"],
    monthlyEmi: loan ? String(loan.monthlyEmi) : "",
    repaymentFrequency: (loan?.repaymentFrequency ?? "Monthly") as Loan["repaymentFrequency"],
    nextRepaymentDate: loan?.nextRepaymentDate ?? "",
    dueDayOfMonth: loan?.dueDayOfMonth !== undefined ? String(loan.dueDayOfMonth) : "",
    isDirectDebit: loan?.isDirectDebit ?? true,
    linkedBankAccount: loan?.linkedBankAccount ?? "",
    startDate: loan?.startDate ?? "",
    maturityDate: loan?.maturityDate ?? "",
    hasOffsetAccount: loan?.hasOffsetAccount ?? false,
    offsetBalance: loan?.offsetBalance !== undefined ? String(loan.offsetBalance) : "",
    status: (loan?.status ?? "Active") as Loan["status"],
    notes: loan?.notes ?? "",
    sourceFileName: undefined as string | undefined,
    sourceFileData: undefined as string | undefined,
  });

  const [form, setForm] = useState(blankForm());

  const reset = () => {
    generationRef.current++;
    setForm(blankForm());
    setExtractOk(false);
    setExtractEmpty(false);
    setDocExpanded(false);
  };

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) setForm(blankForm());
    else reset();
  };

  const extract = async (file: File) => {
    if (file.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(file.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
    const generation = generationRef.current;
    setBusy(true);
    setExtractOk(false);
    setExtractEmpty(false);
    try {
      const base64 = await readFileAsBase64(file);
      if (generationRef.current !== generation) return;
      setForm((f) => ({ ...f, sourceFileName: file.name, sourceFileData: base64 }));

      const { data, error } = await supabase.functions.invoke<ExtractResult>("extract-loan-document", {
        body: { fileBase64: base64, fileName: file.name, mimeType: file.type || "application/pdf" },
      });
      if (generationRef.current !== generation) return;
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this document");
        return;
      }

      setForm((f) => ({
        ...f,
        bankName: data.lender_name || f.bankName,
        originalAmount: data.loan_amount != null ? String(data.loan_amount) : f.originalAmount,
        // A brand-new loan's current balance starts at the amount drawn — only fills this in
        // when it's still empty, so re-extracting into an already-edited form never clobbers a
        // balance the landlord has since adjusted.
        totalBalance: !f.totalBalance && data.loan_amount != null ? String(data.loan_amount) : f.totalBalance,
        interestRate: data.interest_rate != null ? String(data.interest_rate) : f.interestRate,
        monthlyEmi: data.monthly_repayment != null ? String(data.monthly_repayment) : f.monthlyEmi,
        startDate: data.start_date || f.startDate,
        maturityDate: data.maturity_date || f.maturityDate,
        nextRepaymentDate: data.next_repayment_date || f.nextRepaymentDate,
        // Drives the month-on-month "EMI due soon" forecast (HousekeepingWidget on the
        // Dashboard), which only ever reads dueDayOfMonth — a next_repayment_date with no day-of-
        // month derived from it would leave that forecast silently empty.
        dueDayOfMonth: data.next_repayment_date ? String(new Date(data.next_repayment_date).getDate()) : f.dueDayOfMonth,
        productType: data.product_type || f.productType,
        bsb: data.bsb || f.bsb,
        accountNumber: data.account_number || f.accountNumber,
        hasOffsetAccount: data.has_offset_account ?? f.hasOffsetAccount,
      }));

      if (!data.lender_name && data.loan_amount == null) {
        setExtractEmpty(true);
      } else {
        setExtractOk(true);
        toast.success("Extracted — review the fields before saving");
      }
    } catch (e) {
      if (generationRef.current === generation) toast.error(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      if (generationRef.current === generation) setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void extract(f);
  };

  const save = () => {
    if (!form.propertyId) return toast.error("Property is required");
    if (!form.bankName.trim()) return toast.error("Lender name is required");
    if (!form.totalBalance || parseFloat(form.totalBalance) < 0) return toast.error("Enter the current balance");
    if (!form.interestRate) return toast.error("Enter the interest rate");

    const payload = {
      propertyId: form.propertyId,
      bankName: form.bankName.trim(),
      bsb: form.bsb.trim() || undefined,
      accountNumber: form.accountNumber.trim() || undefined,
      productType: form.productType.trim() || undefined,
      loanType: form.loanType,
      purpose: form.purpose,
      originalAmount: form.originalAmount ? parseFloat(form.originalAmount) || 0 : undefined,
      totalBalance: parseFloat(form.totalBalance) || 0,
      creditLimit: form.creditLimit ? parseFloat(form.creditLimit) || 0 : undefined,
      interestRate: parseFloat(form.interestRate) || 0,
      rateType: form.rateType,
      monthlyEmi: parseFloat(form.monthlyEmi) || 0,
      repaymentFrequency: form.repaymentFrequency,
      nextRepaymentDate: form.nextRepaymentDate || undefined,
      dueDayOfMonth: form.dueDayOfMonth ? parseInt(form.dueDayOfMonth, 10) : undefined,
      isDirectDebit: form.isDirectDebit,
      linkedBankAccount: form.linkedBankAccount.trim() || undefined,
      startDate: form.startDate || undefined,
      maturityDate: form.maturityDate || undefined,
      hasOffsetAccount: form.hasOffsetAccount,
      offsetBalance: form.hasOffsetAccount && form.offsetBalance ? parseFloat(form.offsetBalance) || 0 : undefined,
      status: form.status,
      notes: form.notes || undefined,
    };

    if (isEdit && loan) {
      updateLoan(loan.id, payload);
      toast.success("Loan updated");
    } else {
      addLoan(payload);
      toast.success("Loan added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1">
            <Plus className="h-3 w-3" /> Add Loan
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className={
          docExpanded
            ? "flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-y-auto"
            : isEdit
              ? "max-h-[90vh] max-w-2xl overflow-y-auto"
              : "max-h-[90vh] max-w-5xl overflow-y-auto"
        }
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit loan" : "Add loan"}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {isEdit ? "Update this loan's details." : "Upload the loan offer/contract for AI extraction, or enter the details manually."}
          </div>
        </DialogHeader>

        <div
          className={
            isEdit
              ? "space-y-4 text-sm"
              : "grid gap-4 text-sm " + (docExpanded ? "flex-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_380px]" : "md:grid-cols-[340px_1fr]")
          }
        >
          {!isEdit && (
            <div className={"space-y-3 " + (docExpanded ? "overflow-y-auto pr-1" : "")}>
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
                  <div className="text-xs text-muted-foreground">
                    {busy ? "Reading document…" : "Drop the loan offer/contract here, or choose a file."}
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
                {extractOk && (
                  <div className="mt-2 flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-2 text-xs text-emerald-900">
                    <CheckCircle2 className="h-3 w-3 shrink-0" /> Extracted — review the fields before saving.
                  </div>
                )}
                {extractEmpty && (
                  <div className="mt-2 flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Couldn't find loan details in this file — the document is still attached, fill in the fields manually.
                  </div>
                )}
              </div>

              <BillDocumentViewer
                fileName={form.sourceFileName}
                fileData={form.sourceFileData}
                expanded={docExpanded}
                onToggleExpand={() => setDocExpanded((v) => !v)}
                onRemove={
                  form.sourceFileName
                    ? () => setForm((f) => ({ ...f, sourceFileName: undefined, sourceFileData: undefined }))
                    : undefined
                }
              />
            </div>
          )}

          <div className={!isEdit ? "space-y-4 " + (docExpanded ? "overflow-y-auto pl-1" : "") : ""}>
            {!lockedPropertyId && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-xs font-medium">Property</div>
                <Field label="Secured against">
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

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Lender details</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Lender / bank name">
                    <Input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
                  </Field>
                </div>
                <Field label="BSB">
                  <Input value={form.bsb} onChange={(e) => setForm((f) => ({ ...f, bsb: e.target.value }))} placeholder="000-000" />
                </Field>
                <Field label="Account number">
                  <Input value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />
                </Field>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Loan details</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Product type">
                  <Input value={form.productType} onChange={(e) => setForm((f) => ({ ...f, productType: e.target.value }))} placeholder="e.g. Home Loan" />
                </Field>
                <Field label="Loan type">
                  <Select value={form.loanType} onValueChange={(v) => setForm((f) => ({ ...f, loanType: v as Loan["loanType"] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Principal & Interest">Principal & Interest</SelectItem>
                      <SelectItem value="Interest Only">Interest Only</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Purpose">
                  <Select value={form.purpose} onValueChange={(v) => setForm((f) => ({ ...f, purpose: v as Loan["purpose"] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Investment">Investment</SelectItem>
                      <SelectItem value="Owner Occupied">Owner Occupied</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Original loan amount">
                  <Input type="number" value={form.originalAmount} onChange={(e) => setForm((f) => ({ ...f, originalAmount: e.target.value }))} />
                </Field>
                <Field label="Current balance">
                  <Input type="number" value={form.totalBalance} onChange={(e) => setForm((f) => ({ ...f, totalBalance: e.target.value }))} />
                </Field>
                <Field label="Credit limit (line of credit)">
                  <Input type="number" value={form.creditLimit} onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))} />
                </Field>
                <Field label="Status">
                  <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as Loan["status"] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Paid Off">Paid Off</SelectItem>
                      <SelectItem value="In Arrears">In Arrears</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Interest</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Interest rate (%)">
                  <Input type="number" step="0.01" value={form.interestRate} onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value }))} />
                </Field>
                <Field label="Rate type">
                  <Select value={form.rateType} onValueChange={(v) => setForm((f) => ({ ...f, rateType: v as Loan["rateType"] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Variable">Variable</SelectItem>
                      <SelectItem value="Fixed">Fixed</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Repayments</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Repayment amount">
                  <Input type="number" value={form.monthlyEmi} onChange={(e) => setForm((f) => ({ ...f, monthlyEmi: e.target.value }))} />
                </Field>
                <Field label="Frequency">
                  <Select value={form.repaymentFrequency} onValueChange={(v) => setForm((f) => ({ ...f, repaymentFrequency: v as Loan["repaymentFrequency"] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Weekly">Weekly</SelectItem>
                      <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                      <SelectItem value="Monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Next repayment date">
                  <Input type="date" value={form.nextRepaymentDate} onChange={(e) => setForm((f) => ({ ...f, nextRepaymentDate: e.target.value }))} />
                </Field>
                <Field label="Due day of month">
                  <Input type="number" min="1" max="31" value={form.dueDayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dueDayOfMonth: e.target.value }))} />
                </Field>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Repayment account</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Account repayments are drawn from">
                  <Input value={form.linkedBankAccount} onChange={(e) => setForm((f) => ({ ...f, linkedBankAccount: e.target.value }))} placeholder="e.g. Everyday account ...1234" />
                </Field>
                <div className="flex items-end justify-between gap-2 rounded border p-2">
                  <span className="text-xs">Direct debit</span>
                  <Switch checked={form.isDirectDebit} onCheckedChange={(v) => setForm((f) => ({ ...f, isDirectDebit: v }))} />
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">Dates</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start date">
                  <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                </Field>
                <Field label="Maturity date">
                  <Input type="date" value={form.maturityDate} onChange={(e) => setForm((f) => ({ ...f, maturityDate: e.target.value }))} />
                </Field>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Offset account</div>
                <Switch checked={form.hasOffsetAccount} onCheckedChange={(v) => setForm((f) => ({ ...f, hasOffsetAccount: v }))} />
              </div>
              {form.hasOffsetAccount && (
                <Field label="Offset balance">
                  <Input type="number" value={form.offsetBalance} onChange={(e) => setForm((f) => ({ ...f, offsetBalance: e.target.value }))} />
                </Field>
              )}
            </div>

            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {isEdit && loan ? (
            <Button
              variant="ghost"
              className="gap-1 text-destructive"
              onClick={() => {
                if (confirm(`Delete the ${loan.bankName} loan?`)) {
                  deleteLoan(loan.id);
                  toast.success("Loan removed");
                  setOpen(false);
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
