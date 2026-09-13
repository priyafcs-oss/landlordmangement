import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import type { PropertyBill } from "@/lib/types";

const PAYMENT_METHODS: NonNullable<PropertyBill["paymentMethod"]>[] = [
  "Bank Transfer",
  "BPAY",
  "Direct Debit",
  "Credit Card",
  "Cash",
  "Other",
];

/**
 * Mark Paid confirmation — lets the landlord record the actual paid date, how it was paid, and
 * (for a rounding difference, discount, or partial payment) an amount other than the bill's full
 * amount, instead of markBillPaid silently posting today's date and the full billed amount.
 *
 * Supports two ways of opening it: an internal trigger (pass `trigger`, or the default button),
 * or fully controlled via `open`/`onOpenChange` with no trigger of its own — needed anywhere the
 * "Mark paid" action lives inside a dropdown menu, since a DropdownMenuItem closes its menu (and
 * would unmount a nested DialogTrigger) the instant it's clicked.
 */
export function MarkBillPaidDialog({
  bill,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  bill: PropertyBill;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { markBillPaid } = useStore();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  // Already partially paid? Default to what's actually still owed, not the bill's original full
  // amount — this dialog reopens for "pay the remainder" too, not just a fresh payment.
  const remainingOwed = bill.status === "Partial" ? bill.amount - (bill.paidAmount ?? 0) : bill.amount;
  const [paidDate, setPaidDate] = useState(todayISO());
  const [paymentMethod, setPaymentMethod] = useState<NonNullable<PropertyBill["paymentMethod"]>>("Bank Transfer");
  const [amount, setAmount] = useState(String(remainingOwed));

  const setOpen = (o: boolean) => {
    if (controlled) onOpenChangeProp?.(o);
    else setOpenState(o);
  };

  const submit = () => {
    const parsed = parseFloat(amount);
    if (!(parsed > 0)) return toast.error("Enter an amount greater than zero");
    const result = markBillPaid(bill.id, { paidDate, paymentMethod, amount: parsed });
    if (result.overflow) {
      toast.success(
        `Paid in full — ${fmtCurrency(result.overflow.totalApplied)} applied to ${result.overflow.instalmentsAffected} upcoming instalment${result.overflow.instalmentsAffected === 1 ? "" : "s"}`,
      );
    } else if (result.status === "Partial") {
      toast.success(`Partial payment recorded — ${fmtCurrency(result.amountApplied)} of ${fmtCurrency(result.amountOwed)}`);
    } else {
      toast.success("Marked paid — posted to Transactions");
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setPaidDate(todayISO());
          setPaymentMethod("Bank Transfer");
          setAmount(String(remainingOwed));
        }
      }}
    >
      {!controlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Mark paid
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark paid</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {bill.label ?? bill.billType} — billed {fmtCurrency(bill.amount)}
            {bill.status === "Partial" && ` — ${fmtCurrency(remainingOwed)} still owed`}
          </div>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {bill.billGroupId && (
            <p className="text-xs text-muted-foreground">
              Paying more than what's owed here applies the extra to the next instalment; paying less leaves this one marked partial.
            </p>
          )}
          <Field label="Date paid">
            <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
          <Field label="Paid via">
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount paid">
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="gap-1" onClick={submit}>
            <CheckCircle2 className="h-3 w-3" /> Confirm paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
