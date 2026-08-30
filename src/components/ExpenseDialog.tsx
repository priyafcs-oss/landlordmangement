import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { todayISO, CATEGORY_GROUPS, expenseCategoryToTaxCategory } from "@/lib/calculations";
import { toast } from "sonner";
import type { Expense, ExpenseCategory } from "@/lib/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** Sentinel for "no specific dwelling" in the Dwelling Select — Radix Select item values can't be
 * an empty string, and shared/whole-property genuinely needs its own selectable option. */
const SHARED_UNIT = "__shared__";

/** Simple single-category expense form — used for editing an existing expense (e.g. from the
 * needs-review queue). New expenses are created via AddTransactionDialog instead, which supports
 * multi-line-item receipts and property-split; this stays around purely for the edit path. */
export function ExpenseDialog({
  expense,
  trigger,
}: {
  expense?: Expense;
  trigger?: React.ReactNode;
} = {}) {
  const { state, addExpense, updateExpense, addInvoice, findOrCreateProvider } = useStore();
  const [open, setOpen] = useState(false);
  const isEdit = !!expense;
  const [form, setForm] = useState(() =>
    expense
      ? {
          itemName: expense.itemName,
          cost: String(expense.cost),
          date: expense.date,
          propertyId: expense.propertyId ?? state.properties[0]?.id ?? "",
          unitId: expense.unitId ?? SHARED_UNIT,
          category: (expense.category ?? "Sundry Rental Expenses") as ExpenseCategory,
          providerName: expense.providerName ?? "",
          gst: expense.gst !== undefined ? String(expense.gst) : "",
          hasWarranty: expense.hasWarranty,
          warrantyExpiry: expense.warrantyExpiry ?? "",
          rechargeToTenant: expense.rechargeToTenant,
          tenantId: expense.tenantId ?? "",
          invoiceFileName: expense.invoiceFileName ?? "",
          invoiceFileData: expense.invoiceFileData ?? "",
        }
      : {
          itemName: "",
          cost: "",
          date: todayISO(),
          propertyId: state.properties[0]?.id ?? "",
          unitId: SHARED_UNIT,
          category: "Sundry Rental Expenses" as ExpenseCategory,
          providerName: "",
          gst: "",
          hasWarranty: false,
          warrantyExpiry: "",
          rechargeToTenant: false,
          tenantId: "",
          invoiceFileName: "",
          invoiceFileData: "",
        },
  );

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((s) => ({ ...s, invoiceFileName: f.name, invoiceFileData: String(reader.result) }));
    };
    reader.readAsDataURL(f);
  };

  const submit = () => {
    if (!form.itemName || !form.propertyId) return toast.error("Item and property required");
    const cost = parseFloat(form.cost) || 0;
    const payload = {
      itemName: form.itemName,
      cost,
      date: form.date,
      propertyId: form.propertyId,
      unitId: form.unitId !== SHARED_UNIT ? form.unitId : undefined,
      category: form.category,
      providerName: form.providerName.trim() || undefined,
      gst: form.gst ? parseFloat(form.gst) || 0 : undefined,
      taxCategory: expenseCategoryToTaxCategory(form.category),
      hasWarranty: form.hasWarranty,
      warrantyExpiry: form.hasWarranty ? form.warrantyExpiry : undefined,
      rechargeToTenant: form.rechargeToTenant,
      tenantId: form.rechargeToTenant ? form.tenantId : undefined,
      invoiceFileName: form.invoiceFileName || undefined,
      invoiceFileData: form.invoiceFileData || undefined,
    };

    if (payload.providerName) findOrCreateProvider(payload.providerName, form.propertyId);

    if (isEdit && expense) {
      updateExpense(expense.id, payload);
      if (form.rechargeToTenant && form.tenantId && !expense.recharged) {
        addInvoice({
          tenantId: form.tenantId,
          chargeType: "Other",
          amountDue: cost,
          dateIssued: form.date,
          dueDate: new Date(new Date(form.date).getTime() + 14 * 86400000).toISOString().slice(0, 10),
          status: "Unpaid",
          description: form.itemName,
        });
        updateExpense(expense.id, { recharged: true });
      }
      toast.success("Expense updated");
      setOpen(false);
      return;
    }

    addExpense({ ...payload, status: "approved", source: "manual" });
    if (form.rechargeToTenant && form.tenantId) {
      addInvoice({
        tenantId: form.tenantId,
        chargeType: "Other",
        amountDue: cost,
        dateIssued: form.date,
        dueDate: new Date(new Date(form.date).getTime() + 14 * 86400000).toISOString().slice(0, 10),
        status: "Unpaid",
        description: form.itemName,
      });
      toast.success("Expense logged and recharged to tenant");
    } else {
      toast.success("Expense logged");
    }
    setOpen(false);
    setForm({
      itemName: "",
      cost: "",
      date: todayISO(),
      propertyId: state.properties[0]?.id ?? "",
      unitId: SHARED_UNIT,
      category: "Sundry Rental Expenses",
      providerName: "",
      gst: "",
      hasWarranty: false,
      warrantyExpiry: "",
      rechargeToTenant: false,
      tenantId: "",
      invoiceFileName: "",
      invoiceFileData: "",
    });
  };

  const tenantsForProp = state.tenants.filter((t) => t.propertyId === form.propertyId);
  const propertyUnits = state.properties.find((p) => p.id === form.propertyId)?.units ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Log Expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit expense" : "New expense / maintenance"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item">
            <Input value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
          </Field>
          <Field label="Provider / payee">
            <Input value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} />
          </Field>
          <Field label="Cost (AUD)">
            <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </Field>
          <Field label="GST (AUD)">
            <Input type="number" value={form.gst} onChange={(e) => setForm({ ...form, gst: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Property">
            <Select value={form.propertyId} onValueChange={(v) => setForm({ ...form, propertyId: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {propertyUnits.length > 0 && (
            <Field label="Dwelling">
              <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                <SelectTrigger>
                  <SelectValue />
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
          )}
          <Field label="Category">
            <Select
              value={form.category}
              onValueChange={(v) => setForm({ ...form, category: v as ExpenseCategory })}
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
          <Field label="Invoice attachment">
            <Input type="file" onChange={(e) => handleFile(e.target.files?.[0])} />
          </Field>
          <div className="col-span-full flex items-center justify-between rounded border p-3">
            <div>
              <div className="text-sm font-medium">Has warranty?</div>
              <div className="text-xs text-muted-foreground">Track expiry for insurance claims.</div>
            </div>
            <Switch checked={form.hasWarranty} onCheckedChange={(v) => setForm({ ...form, hasWarranty: v })} />
          </div>
          {form.hasWarranty && (
            <Field label="Warranty expiry">
              <Input
                type="date"
                value={form.warrantyExpiry}
                onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })}
              />
            </Field>
          )}
          <div className="col-span-full flex items-center justify-between rounded border p-3">
            <div>
              <div className="text-sm font-medium">Recharge to tenant?</div>
              <div className="text-xs text-muted-foreground">
                Auto-generates a tenant invoice for this amount.
              </div>
            </div>
            <Switch
              checked={form.rechargeToTenant}
              onCheckedChange={(v) => setForm({ ...form, rechargeToTenant: v })}
            />
          </div>
          {form.rechargeToTenant && (
            <Field label="Tenant">
              <Select value={form.tenantId} onValueChange={(v) => setForm({ ...form, tenantId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenantsForProp.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
