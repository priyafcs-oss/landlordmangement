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
import type { Loan } from "@/lib/types";

/**
 * Manual Add/Edit Loan — previously the only way a Loan record ever came into existence was an
 * AI-parsed loan-document proposal; there was no way to just type one in. Fields go beyond the
 * original bare-minimum Loan shape (bank/balance/rate/EMI) to cover what a landlord would actually
 * want on file for a mortgage: lender account details, loan type/purpose, rate type, repayment
 * schedule, offset account, and key dates — all optional beyond the original required set, so
 * existing loans/callers are unaffected.
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

  const blankForm = () => ({
    propertyId: loan?.propertyId ?? lockedPropertyId ?? state.properties[0]?.id ?? "",
    bankName: loan?.bankName ?? "",
    bsb: loan?.bsb ?? "",
    accountNumber: loan?.accountNumber ?? "",
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
  });

  const [form, setForm] = useState(blankForm());

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) setForm(blankForm());
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit loan" : "Add loan"}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {isEdit ? "Update this loan's details." : "Enter the loan's details manually."}
          </div>
        </DialogHeader>

        <div className="space-y-4 text-sm">
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
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
