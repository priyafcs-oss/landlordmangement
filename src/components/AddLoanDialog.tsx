import { useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import type { Loan } from "@/lib/types";
import { useAiExtraction } from "@/lib/useAiExtraction";
import { loanFieldsFromPayload, loanPayloadFromExtract, type LoanExtractResult } from "@/lib/extractMappers";
import { DocumentDropzone } from "@/components/DocumentDropzone";
import { documentLayout } from "@/lib/documentLayout";

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
  refinanceFrom,
  propertyId: lockedPropertyId,
  initialValues,
  onCreated,
  trigger,
}: {
  /** Edits an existing Loan in place instead of creating a new one. */
  loan?: Loan;
  /** Refinance instead of a plain edit or a from-scratch add: creates a brand-new Loan for the
   * same property (pre-filled from this one, so only the changed terms need retyping) and, on
   * save, marks this loan "Paid Off" instead of overwriting it — so the original lender/rate/
   * balance stay on record as history rather than being silently replaced in place. */
  refinanceFrom?: Loan;
  /** Pre-fills and locks the property when adding from a property-scoped page (e.g. the
   * property's own Loans tab) — omit for the portfolio-wide Loans summary, where the landlord
   * picks the property themselves. */
  propertyId?: string;
  /** Pre-fills a *new* loan's fields from AI-extracted data (e.g. src/components/AiPlanStepList.tsx).
   * Ignored in edit/refinance mode. */
  initialValues?: { bankName?: string; originalAmount?: number; interestRate?: number; monthlyEmi?: number };
  /** Called after a *new* loan is actually created (not on edit/refinance, not when the dialog
   * merely opens), with its id. */
  onCreated?: (loanId: string) => void;
  trigger?: React.ReactNode;
}) {
  const { state, addLoan, updateLoan, deleteLoan } = useStore();
  const [open, setOpen] = useState(false);
  const isEdit = !!loan;
  const isRefinance = !isEdit && !!refinanceFrom;
  // What to prefill the form from — the loan being edited, or (for a refinance) the loan being
  // replaced, since its terms are the sensible starting point for the new one.
  const prefill = loan ?? refinanceFrom;
  const [docExpanded, setDocExpanded] = useState(false);
  const layout = documentLayout(docExpanded, isEdit ? { dialog: "max-h-[90vh] max-w-2xl overflow-y-auto" } : {});
  // Bumped on every reset so an extraction still in flight when the dialog is closed can tell
  // its own result is stale and skip applying it — same pattern as Add Bill/Transaction/
  // Depreciation Report.

  const blankForm = () => ({
    propertyId: prefill?.propertyId ?? lockedPropertyId ?? state.properties[0]?.id ?? "",
    // A refinance is a new lender/product by definition — leave these blank to type in, rather
    // than prefilling the old bank's own details onto what's meant to replace them.
    bankName: isRefinance ? "" : (prefill?.bankName ?? initialValues?.bankName ?? ""),
    bsb: isRefinance ? "" : (prefill?.bsb ?? ""),
    accountNumber: isRefinance ? "" : (prefill?.accountNumber ?? ""),
    productType: isRefinance ? "" : (prefill?.productType ?? ""),
    loanType: (prefill?.loanType ?? "Principal & Interest") as Loan["loanType"],
    purpose: (prefill?.purpose ?? "Investment") as Loan["purpose"],
    originalAmount: prefill?.originalAmount !== undefined ? String(prefill.originalAmount) : initialValues?.originalAmount !== undefined ? String(initialValues.originalAmount) : "",
    totalBalance: prefill ? String(prefill.totalBalance) : initialValues?.originalAmount !== undefined ? String(initialValues.originalAmount) : "",
    creditLimit: prefill?.creditLimit !== undefined ? String(prefill.creditLimit) : "",
    interestRate: isRefinance ? "" : prefill ? String(prefill.interestRate) : initialValues?.interestRate !== undefined ? String(initialValues.interestRate) : "",
    rateType: (prefill?.rateType ?? "Variable") as Loan["rateType"],
    monthlyEmi: isRefinance ? "" : prefill ? String(prefill.monthlyEmi) : initialValues?.monthlyEmi !== undefined ? String(initialValues.monthlyEmi) : "",
    repaymentFrequency: (prefill?.repaymentFrequency ?? "Monthly") as Loan["repaymentFrequency"],
    nextRepaymentDate: isRefinance ? "" : (prefill?.nextRepaymentDate ?? ""),
    dueDayOfMonth: isRefinance ? "" : prefill?.dueDayOfMonth !== undefined ? String(prefill.dueDayOfMonth) : "",
    isDirectDebit: prefill?.isDirectDebit ?? true,
    linkedBankAccount: isRefinance ? "" : (prefill?.linkedBankAccount ?? ""),
    startDate: isRefinance ? "" : (prefill?.startDate ?? ""),
    maturityDate: isRefinance ? "" : (prefill?.maturityDate ?? ""),
    hasOffsetAccount: isRefinance ? false : (prefill?.hasOffsetAccount ?? false),
    offsetBalance: isRefinance ? "" : prefill?.offsetBalance !== undefined ? String(prefill.offsetBalance) : "",
    // A refinance always starts life Active, regardless of the old loan's own status.
    status: (isRefinance ? "Active" : (prefill?.status ?? "Active")) as Loan["status"],
    notes: isRefinance ? "" : (prefill?.notes ?? ""),
    sourceFileName: undefined as string | undefined,
    sourceFileData: undefined as string | undefined,
  });

  const [form, setForm] = useState(blankForm());

  const reading = useAiExtraction<LoanExtractResult>({
    fn: "extract-loan-document",
    onAttach: (sourceFileName, sourceFileData) => setForm((f) => ({ ...f, sourceFileName, sourceFileData })),
    emptyMessage: "Couldn't find loan details in this file — fill in the fields manually",
    apply: (data) => {
      const l = loanFieldsFromPayload(loanPayloadFromExtract(data));
      const str = (n: number | undefined, fallback: string) => (n != null ? String(n) : fallback);
      setForm((f) => ({
        ...f,
        bankName: l.bankName ?? f.bankName,
        originalAmount: str(l.originalAmount, f.originalAmount),
        // A brand-new loan's balance starts at the amount drawn — only filled in while empty, so
        // reading again never clobbers a balance the landlord has since adjusted.
        totalBalance: !f.totalBalance ? str(l.totalBalance, f.totalBalance) : f.totalBalance,
        interestRate: str(l.interestRate, f.interestRate),
        monthlyEmi: str(l.monthlyEmi, f.monthlyEmi),
        startDate: l.startDate ?? f.startDate,
        maturityDate: l.maturityDate ?? f.maturityDate,
        nextRepaymentDate: l.nextRepaymentDate ?? f.nextRepaymentDate,
        dueDayOfMonth: str(l.dueDayOfMonth, f.dueDayOfMonth),
        productType: l.productType ?? f.productType,
        bsb: l.bsb ?? f.bsb,
        accountNumber: l.accountNumber ?? f.accountNumber,
        hasOffsetAccount: l.hasOffsetAccount ?? f.hasOffsetAccount,
      }));
      return { empty: !data.lender_name && data.loan_amount == null };
    },
  });
  const busy = reading.busy;

  const reset = () => {
    reading.reset();
    setForm(blankForm());
    setDocExpanded(false);
  };

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) setForm(blankForm());
    else reset();
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
      sourceFileName: form.sourceFileName,
      sourceFileData: form.sourceFileData,
    };

    if (isEdit && loan) {
      updateLoan(loan.id, payload);
      toast.success("Loan updated");
    } else if (isRefinance && refinanceFrom) {
      addLoan(payload);
      updateLoan(refinanceFrom.id, { status: "Paid Off" });
      toast.success(`Refinanced — new loan added, ${refinanceFrom.bankName} kept on record as history`);
    } else {
      const newId = addLoan(payload);
      onCreated?.(newId);
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
        className={layout.dialog}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit loan" : isRefinance ? `Refinance ${refinanceFrom!.bankName} loan` : "Add loan"}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {isEdit
              ? "Update this loan's details."
              : isRefinance
                ? `Pre-filled from the ${refinanceFrom!.bankName} loan — enter the new lender's details below. Saving keeps the old loan on record as history instead of overwriting it.`
                : "Upload the loan offer/contract for AI extraction, or enter the details manually."}
          </div>
        </DialogHeader>

        <div
          className={
            isEdit
              ? "space-y-4 text-sm"
              : layout.grid
          }
        >
          {!isEdit && (
            <div className={"space-y-3 " + layout.left}>
              <DocumentDropzone
                prompt="Drop the loan offer/contract here, or choose a file."
                busy={reading.busy}
                status={reading.status}
                fileName={form.sourceFileName}
                fileData={form.sourceFileData}
                onFile={(f) => void reading.extract(f)}
                onReread={() => void reading.reread(form.sourceFileName, form.sourceFileData)}
                okText="Extracted — review the fields before saving."
                emptyText="Couldn't find loan details in this file — the document is still attached, fill in the fields manually."
              />

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

          <div className={!isEdit ? "space-y-4 " + layout.right : ""}>
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
