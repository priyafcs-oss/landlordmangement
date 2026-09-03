import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BankAccount } from "@/lib/types";

/**
 * Manual Add/Edit for a cash bank account under an Entity — Institution/BSB/account
 * number/balance, entered by hand (no live bank feed yet). Deliberately separate from
 * AddLoanDialog: a loan already has its own dedicated workflow (AI extraction, statement
 * history, offset tracking) that a "just add a cash account" form must never risk clobbering.
 */
export function AddBankAccountDialog({
  account,
  entityId,
  trigger,
}: {
  /** Edits an existing account in place instead of creating a new one. */
  account?: BankAccount;
  /** Entity this account belongs to — locked, not user-editable, since this dialog is always
   * opened from within one entity's own Bank Accounts tab. */
  entityId: string;
  trigger?: React.ReactNode;
}) {
  const { addBankAccount, updateBankAccount, deleteBankAccount } = useStore();
  const [open, setOpen] = useState(false);
  const isEdit = !!account;

  const blankForm = () => ({
    institution: account?.institution ?? "",
    accountName: account?.accountName ?? "",
    accountType: (account?.accountType ?? "Transaction") as BankAccount["accountType"],
    bsb: account?.bsb ?? "",
    accountNumber: account?.accountNumber ?? "",
    currentBalance: account ? String(account.currentBalance) : "",
    notes: account?.notes ?? "",
  });

  const [form, setForm] = useState(blankForm());

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) setForm(blankForm());
  };

  const save = () => {
    if (!form.accountName.trim()) return toast.error("Account name is required");

    const payload = {
      entityId,
      institution: form.institution.trim() || undefined,
      accountName: form.accountName.trim(),
      accountType: form.accountType,
      bsb: form.bsb.trim() || undefined,
      accountNumber: form.accountNumber.trim() || undefined,
      currentBalance: parseFloat(form.currentBalance) || 0,
      notes: form.notes.trim() || undefined,
    };

    if (isEdit && account) {
      updateBankAccount(account.id, payload);
      toast.success("Bank account updated");
    } else {
      addBankAccount(payload);
      toast.success("Bank account added");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1">
            <Plus className="h-3 w-3" /> Add bank account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit bank account" : "Add bank account"}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {isEdit ? "Update this cash account's details." : "Enter a cash account now. You can connect its live bank feed later."}
          </div>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-2 rounded-md border p-3">
            <div className="text-xs font-medium">Cash account details</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Institution">
                  <Input
                    value={form.institution}
                    onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
                    placeholder="e.g. CommBank"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Account name">
                  <Input
                    value={form.accountName}
                    onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
                    placeholder="e.g. Everyday Account"
                  />
                </Field>
              </div>
              <Field label="Account type">
                <Select
                  value={form.accountType}
                  onValueChange={(v) => setForm((f) => ({ ...f, accountType: v as BankAccount["accountType"] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Transaction">Transaction</SelectItem>
                    <SelectItem value="Savings">Savings</SelectItem>
                    <SelectItem value="Offset">Offset</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Current balance">
                <Input
                  type="number"
                  value={form.currentBalance}
                  onChange={(e) => setForm((f) => ({ ...f, currentBalance: e.target.value }))}
                  placeholder="$"
                />
              </Field>
              <Field label="BSB">
                <Input value={form.bsb} onChange={(e) => setForm((f) => ({ ...f, bsb: e.target.value }))} placeholder="123-456" />
              </Field>
              <Field label="Account number">
                <Input
                  value={form.accountNumber}
                  onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  placeholder="12345678"
                />
              </Field>
            </div>
          </div>

          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {isEdit && account ? (
            <Button
              variant="ghost"
              className="gap-1 text-destructive"
              onClick={() => {
                if (confirm(`Delete the ${account.accountName} account?`)) {
                  deleteBankAccount(account.id);
                  toast.success("Bank account removed");
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
