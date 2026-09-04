import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { todayISO, expenseCategoryToTaxCategory } from "@/lib/calculations";
import type { Loan } from "@/lib/types";

/**
 * Manually record one whole P&I repayment against a loan — the counterpart to the AI-reviewed
 * "Upload statement" path (UploadDocumentDialog → LoanStatementProposalCard) for a landlord who
 * just wants to type in a payment as it happens rather than wait for/upload a lender statement.
 * Interest and an eligible lender fee each post as their own deductible Expense (Interest on
 * Loan / Borrowing Expenses respectively); principal is only ever recorded when the repayment,
 * net of interest and fee, actually reconciles with the stated opening→closing balance change —
 * otherwise it's left out rather than guessed, and the loan's balance still updates from the
 * stated closing balance either way.
 */
export function AddLoanStatementDialog({
  loan,
  trigger,
}: {
  loan: Loan;
  trigger?: React.ReactNode;
}) {
  const { addExpense, addLoanStatement, updateLoan, findOrCreateProvider } = useStore();
  const [open, setOpen] = useState(false);
  const blank = () => ({
    paymentDate: todayISO(),
    repaymentsMade: "",
    interestCharged: "",
    openingBalance: loan.totalBalance ? String(loan.totalBalance) : "",
    closingBalance: "",
    eligibleLenderFee: "",
    description: "",
    periodStart: "",
    periodEnd: "",
  });
  const [form, setForm] = useState(blank());

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) setForm(blank());
  };

  const save = () => {
    if (!form.paymentDate) return toast.error("Payment date is required");
    const repayment = parseFloat(form.repaymentsMade) || 0;
    const interest = parseFloat(form.interestCharged) || 0;
    const fee = parseFloat(form.eligibleLenderFee) || 0;
    const opening = form.openingBalance ? parseFloat(form.openingBalance) : undefined;
    const closing = form.closingBalance ? parseFloat(form.closingBalance) : undefined;

    // Only trust a derived principal figure when it actually agrees with the stated balance
    // change — a mismatch usually means a redraw, an extra payment, or a typo, and guessing at
    // principal in that case would silently corrupt the loan balance.
    let principalPaid: number | undefined;
    if (opening !== undefined && closing !== undefined) {
      const actualChange = opening - closing;
      const impliedPrincipal = repayment - interest - fee;
      if (Math.abs(impliedPrincipal - actualChange) < 1) principalPaid = impliedPrincipal;
    }

    const lenderProviderId = findOrCreateProvider(
      loan.bankName,
      loan.propertyId,
      "Interest on Loan",
    );
    const expenseId = interest
      ? addExpense({
          itemName: `${loan.bankName} — loan interest`,
          cost: interest,
          date: form.paymentDate,
          propertyId: loan.propertyId,
          assetId: loan.assetId,
          category: "Interest on Loan",
          taxCategory: expenseCategoryToTaxCategory("Interest on Loan"),
          providerName: loan.bankName,
          providerId: lenderProviderId,
          hasWarranty: false,
          rechargeToTenant: false,
          status: "approved",
          source: "manual",
        })
      : undefined;
    const feeExpenseId = fee
      ? addExpense({
          itemName: `${loan.bankName} — lender fee`,
          cost: fee,
          date: form.paymentDate,
          propertyId: loan.propertyId,
          assetId: loan.assetId,
          category: "Borrowing Expenses",
          taxCategory: expenseCategoryToTaxCategory("Borrowing Expenses"),
          providerName: loan.bankName,
          providerId: lenderProviderId,
          hasWarranty: false,
          rechargeToTenant: false,
          status: "approved",
          source: "manual",
        })
      : undefined;

    addLoanStatement({
      loanId: loan.id,
      propertyId: loan.propertyId,
      periodStart: form.periodStart || form.paymentDate,
      periodEnd: form.periodEnd || form.paymentDate,
      openingBalance: opening,
      closingBalance: closing,
      interestCharged: interest || undefined,
      eligibleLenderFee: fee || undefined,
      principalPaid,
      repaymentsMade: repayment || undefined,
      description: form.description.trim() || undefined,
      expenseId,
      feeExpenseId,
    });

    if (closing !== undefined) updateLoan(loan.id, { totalBalance: closing });

    toast.success(
      principalPaid !== undefined
        ? "Repayment recorded"
        : "Repayment recorded — principal not derived (repayment, interest and fee don't reconcile with the balance change)",
    );
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Add manual entry">
            <NotebookPen className="h-3 w-3" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add manual entry</DialogTitle>
          <div className="text-xs text-muted-foreground">{loan.bankName}</div>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Payment date">
            <Input
              type="date"
              value={form.paymentDate}
              onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
            />
          </Field>
          <Field label="Whole P&I repayment">
            <Input
              type="number"
              step="0.01"
              value={form.repaymentsMade}
              onChange={(e) => setForm((f) => ({ ...f, repaymentsMade: e.target.value }))}
              placeholder="0.00"
            />
          </Field>
          <Field label="Interest charged separately">
            <Input
              type="number"
              step="0.01"
              value={form.interestCharged}
              onChange={(e) => setForm((f) => ({ ...f, interestCharged: e.target.value }))}
              placeholder="0.00"
            />
          </Field>
          <Field label="Eligible lender fee">
            <Input
              type="number"
              step="0.01"
              value={form.eligibleLenderFee}
              onChange={(e) => setForm((f) => ({ ...f, eligibleLenderFee: e.target.value }))}
              placeholder="0.00"
            />
          </Field>
          <Field label="Opening loan balance">
            <Input
              type="number"
              step="0.01"
              value={form.openingBalance}
              onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
              placeholder="0.00"
            />
          </Field>
          <Field label="Closing loan balance">
            <Input
              type="number"
              step="0.01"
              value={form.closingBalance}
              onChange={(e) => setForm((f) => ({ ...f, closingBalance: e.target.value }))}
              placeholder="0.00"
            />
          </Field>
          <div className="col-span-2">
            <Field label="Description (optional)">
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. August private loan repayment"
              />
            </Field>
          </div>
          <Field label="Period start (optional)">
            <Input
              type="date"
              value={form.periodStart}
              onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
            />
          </Field>
          <Field label="Period end (optional)">
            <Input
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Record each whole P&I payment when it occurs. Interest and the lender fee each post as
          their own deductible expense, dated to the payment date. Principal is only calculated when
          the repayment less interest and fee agrees with the opening→closing balance change —
          otherwise no principal is recorded, though the loan's balance still updates from the
          closing balance above.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Record entry</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
