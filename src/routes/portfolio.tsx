import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Building2, Pencil, Plus, Trash2, User, ShieldCheck, RefreshCw, FileText, History } from "lucide-react";
import { fmtCurrency, addDays } from "@/lib/calculations";
import type { Property, Tenant, RentFrequency, LeaseDuration } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio Manager — Landlord OS" },
      { name: "description", content: "Manage properties, tenants, leases and bond records." },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const { state } = useStore();
  const [openProp, setOpenProp] = useState<Property | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio Manager</h1>
          <p className="text-sm text-muted-foreground">Properties, tenants and leases.</p>
        </div>
        <PropertyDialog onDone={() => setOpenProp(null)} property={openProp} />
      </div>

      {state.properties.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No properties yet. Add your first property to get started.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {state.properties.map((p) => (
          <PropertyCard key={p.id} property={p} onOpen={() => setDrawerId(p.id)} onEdit={() => setOpenProp(p)} />
        ))}
      </div>

      <PropertyDrawer propertyId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  );
}

function PropertyCard({
  property,
  onOpen,
  onEdit,
}: {
  property: Property;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { state, deleteProperty } = useStore();
  const tenants = state.tenants.filter((t) => t.propertyId === property.id);
  const loan = state.loans.find((l) => l.propertyId === property.id);
  const equity = property.currentValue - (loan?.totalBalance ?? 0);
  return (
    <Card className="group overflow-hidden transition hover:shadow-md">
      <div className="flex h-32 items-center justify-center bg-gradient-to-br from-primary/10 to-accent">
        <Building2 className="h-10 w-10 text-primary/40" />
      </div>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <button className="min-w-0 text-left" onClick={onOpen}>
            <div className="truncate text-sm font-semibold">{property.address}</div>
            <div className="mt-1 text-xs text-muted-foreground">Value {fmtCurrency(property.currentValue)}</div>
          </button>
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                if (confirm("Delete this property and all its tenants/records?")) {
                  deleteProperty(property.id);
                  toast.success("Property removed");
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Equity</div>
            <div className="font-medium">{fmtCurrency(equity)}</div>
          </div>
          <div className="rounded bg-muted p-2">
            <div className="text-muted-foreground">Tenants</div>
            <div className="font-medium">{tenants.length}</div>
          </div>
        </div>

        <div className="mt-3">
          {tenants.length > 0 ? (
            tenants.map((t) => (
              <div key={t.id} className="mt-2 flex items-center gap-2 text-xs">
                <User className="h-3 w-3" />
                <span className="truncate">{t.name}</span>
                {t.bondAmount ? (
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Bond
                  </Badge>
                ) : null}
              </div>
            ))
          ) : (
            <TenantDialog propertyId={property.id}>
              <Button size="sm" variant="outline" className="mt-2 w-full">
                <Plus className="mr-1 h-3 w-3" /> Add Tenant
              </Button>
            </TenantDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PropertyDialog({ property, onDone }: { property: Property | null; onDone: () => void }) {
  const { addProperty, updateProperty } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    address: property?.address ?? "",
    purchasePrice: property?.purchasePrice?.toString() ?? "",
    currentValue: property?.currentValue?.toString() ?? "",
  });

  return (
    <Dialog
      open={open || !!property}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onDone();
      }}
    >
      <DialogTrigger asChild>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Property
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{property ? "Edit property" : "New property"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Address">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Purchase price (AUD)">
            <Input
              type="number"
              value={form.purchasePrice}
              onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
            />
          </Field>
          <Field label="Current market value (AUD)">
            <Input
              type="number"
              value={form.currentValue}
              onChange={(e) => setForm({ ...form, currentValue: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!form.address) return toast.error("Address required");
              const payload = {
                address: form.address,
                purchasePrice: parseFloat(form.purchasePrice) || 0,
                currentValue: parseFloat(form.currentValue) || 0,
              };
              if (property) updateProperty(property.id, payload);
              else addProperty(payload);
              setOpen(false);
              onDone();
              setForm({ address: "", purchasePrice: "", currentValue: "" });
              toast.success("Property saved");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PropertyDrawer({ propertyId, onClose }: { propertyId: string | null; onClose: () => void }) {
  const { state, deleteTenant } = useStore();
  const prop = state.properties.find((p) => p.id === propertyId);
  const tenants = state.tenants.filter((t) => t.propertyId === propertyId);
  const loan = state.loans.find((l) => l.propertyId === propertyId);
  const expenses = state.expenses.filter((e) => e.propertyId === propertyId);
  return (
    <Sheet open={!!propertyId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{prop?.address}</SheetTitle>
        </SheetHeader>
        {prop && (
          <div className="mt-4 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Purchase price" value={fmtCurrency(prop.purchasePrice)} />
              <Stat label="Current value" value={fmtCurrency(prop.currentValue)} />
              <Stat label="Loan balance" value={fmtCurrency(loan?.totalBalance ?? 0)} />
              <Stat label="Monthly EMI" value={fmtCurrency(loan?.monthlyEmi ?? 0)} />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">Tenants</div>
                <TenantDialog propertyId={prop.id}>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </TenantDialog>
              </div>
              {tenants.length === 0 && <div className="text-muted-foreground">No tenants linked.</div>}
              {tenants.map((t) => (
                <div key={t.id} className="mb-2 rounded border p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.leaseStart} → {t.leaseExpiry} • {fmtCurrency(t.rentAmount)}/{t.rentFrequency}
                      </div>
                      {t.bondAmount ? (
                        <Badge variant="secondary" className="mt-2 gap-1">
                          <ShieldCheck className="h-3 w-3" /> Bond Secured — {fmtCurrency(t.bondAmount)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex gap-1">
                      <TenantDialog propertyId={prop.id} tenant={t}>
                        <Button size="icon" variant="ghost">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TenantDialog>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete tenant and their ledger history?")) {
                            deleteTenant(t.id);
                            toast.success("Tenant removed");
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Document vault ({expenses.length})</div>
              {expenses.length === 0 && <div className="text-muted-foreground text-xs">No documents.</div>}
              {expenses
                .filter((e) => e.invoiceFileName)
                .map((e) => (
                  <div key={e.id} className="flex justify-between rounded border p-2 text-xs">
                    <span>{e.itemName}</span>
                    <span className="text-muted-foreground">{e.invoiceFileName}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function TenantDialog({
  propertyId,
  tenant,
  children,
}: {
  propertyId: string;
  tenant?: Tenant;
  children?: React.ReactNode;
}) {
  const { addTenant, updateTenant, addRentChange, state } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: tenant?.name ?? "",
    email: tenant?.email ?? "",
    leaseStart: tenant?.leaseStart ?? new Date().toISOString().slice(0, 10),
    leaseExpiry:
      tenant?.leaseExpiry ??
      new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    rentAmount: tenant?.rentAmount?.toString() ?? "",
    rentFrequency: (tenant?.rentFrequency ?? "Weekly") as RentFrequency,
    bankReference: tenant?.bankReference ?? "",
    bankAccountHolder: tenant?.bankAccountHolder ?? "",
    bondAmount: tenant?.bondAmount?.toString() ?? "",
    bondLodgementDate: tenant?.bondLodgementDate ?? "",
    bondReceiptNumber: tenant?.bondReceiptNumber ?? "",
  });

  const check12Months = () => {
    if (!tenant) return true;
    const oldRent = tenant.rentAmount;
    const newRent = parseFloat(form.rentAmount);
    if (oldRent === newRent) return true;
    const last = state.rentChanges
      .filter((r) => r.tenantId === tenant.id)
      .sort((a, b) => (a.changeDate < b.changeDate ? 1 : -1))[0];
    const baseDate = last?.changeDate ?? tenant.leaseStart;
    const daysSince = Math.round((Date.now() - new Date(baseDate).getTime()) / 86400000);
    if (daysSince < 365) {
      return confirm(
        "Compliance Notice: Rent increases are legally restricted to once every 12 months in most Australian jurisdictions. Continue anyway?",
      );
    }
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children ?? <Button size="sm">Add Tenant</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tenant ? "Edit tenant" : "Onboard tenant"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Lease start">
            <Input type="date" value={form.leaseStart} onChange={(e) => setForm({ ...form, leaseStart: e.target.value })} />
          </Field>
          <Field label="Lease expiry">
            <Input type="date" value={form.leaseExpiry} onChange={(e) => setForm({ ...form, leaseExpiry: e.target.value })} />
          </Field>
          <Field label="Rent amount">
            <Input
              type="number"
              value={form.rentAmount}
              onChange={(e) => setForm({ ...form, rentAmount: e.target.value })}
            />
          </Field>
          <Field label="Rent frequency">
            <Select
              value={form.rentFrequency}
              onValueChange={(v) => setForm({ ...form, rentFrequency: v as RentFrequency })}
            >
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
          <Field label="Bank reference code">
            <Input value={form.bankReference} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} />
          </Field>
          <Field label="Bank account holder">
            <Input
              value={form.bankAccountHolder}
              onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })}
            />
          </Field>
          <Field label="Bond amount">
            <Input
              type="number"
              value={form.bondAmount}
              onChange={(e) => setForm({ ...form, bondAmount: e.target.value })}
            />
          </Field>
          <Field label="Bond lodgement date">
            <Input
              type="date"
              value={form.bondLodgementDate}
              onChange={(e) => setForm({ ...form, bondLodgementDate: e.target.value })}
            />
          </Field>
          <Field label="Bond receipt #">
            <Input
              value={form.bondReceiptNumber}
              onChange={(e) => setForm({ ...form, bondReceiptNumber: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!form.name) return toast.error("Name required");
              if (!check12Months()) return;
              const payload: Omit<Tenant, "id" | "paidUpToDate"> & { paidUpToDate?: string } = {
                name: form.name,
                email: form.email,
                propertyId,
                leaseStart: form.leaseStart,
                leaseExpiry: form.leaseExpiry,
                rentAmount: parseFloat(form.rentAmount) || 0,
                rentFrequency: form.rentFrequency,
                bankReference: form.bankReference,
                bankAccountHolder: form.bankAccountHolder,
                bondAmount: form.bondAmount ? parseFloat(form.bondAmount) : undefined,
                bondLodgementDate: form.bondLodgementDate || undefined,
                bondReceiptNumber: form.bondReceiptNumber || undefined,
                paidUpToDate: tenant?.paidUpToDate ?? form.leaseStart,
              };
              if (tenant) {
                if (parseFloat(form.rentAmount) !== tenant.rentAmount) {
                  addRentChange({
                    tenantId: tenant.id,
                    changeDate: new Date().toISOString().slice(0, 10),
                    oldRent: tenant.rentAmount,
                    newRent: parseFloat(form.rentAmount),
                  });
                }
                updateTenant(tenant.id, payload);
              } else {
                addTenant(payload);
              }
              setOpen(false);
              toast.success("Tenant saved");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
