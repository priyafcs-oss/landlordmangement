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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Pencil, Plus, Trash2, User, ShieldCheck, RefreshCw, FileText, History, Receipt, ExternalLink, CheckCircle2 } from "lucide-react";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import type { Property, Tenant, RentFrequency, LeaseDuration, RepaymentFrequency, BillType, PropertyBill } from "@/lib/types";
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
    purchaseDate: property?.purchaseDate ?? "",
    tenantCode: property?.tenantCode ?? "",
    lender: property?.lender ?? "",
    loanAccountRef: property?.loanAccountRef ?? "",
    loanBalance: property?.loanBalance?.toString() ?? "",
    interestRate: property?.interestRate?.toString() ?? "",
    repaymentFrequency: (property?.repaymentFrequency ?? "Monthly") as RepaymentFrequency,
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{property ? "Edit property" : "New property"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Address">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Purchase price (AUD)">
              <Input type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
            </Field>
            <Field label="Current market value (AUD)">
              <Input type="number" value={form.currentValue} onChange={(e) => setForm({ ...form, currentValue: e.target.value })} />
            </Field>
            <Field label="Purchase date">
              <Input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
            </Field>
            <Field label="Tenant code (for maintenance portal)">
              <Input value={form.tenantCode} onChange={(e) => setForm({ ...form, tenantCode: e.target.value.toUpperCase() })} placeholder="e.g. ROSE12" />
            </Field>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">Bank loan (optional)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Lender name">
                <Input value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} />
              </Field>
              <Field label="Loan account / reference">
                <Input value={form.loanAccountRef} onChange={(e) => setForm({ ...form, loanAccountRef: e.target.value })} />
              </Field>
              <Field label="Current loan balance (AUD)">
                <Input type="number" value={form.loanBalance} onChange={(e) => setForm({ ...form, loanBalance: e.target.value })} />
              </Field>
              <Field label="Interest rate (%)">
                <Input type="number" step="0.01" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} />
              </Field>
              <Field label="Repayment frequency">
                <Select value={form.repaymentFrequency} onValueChange={(v) => setForm({ ...form, repaymentFrequency: v as RepaymentFrequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Weekly">Weekly</SelectItem>
                    <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!form.address) return toast.error("Address required");
              const payload = {
                address: form.address,
                purchasePrice: parseFloat(form.purchasePrice) || 0,
                currentValue: parseFloat(form.currentValue) || 0,
                purchaseDate: form.purchaseDate || undefined,
                tenantCode: form.tenantCode || undefined,
                lender: form.lender || undefined,
                loanAccountRef: form.loanAccountRef || undefined,
                loanBalance: form.loanBalance ? parseFloat(form.loanBalance) : undefined,
                interestRate: form.interestRate ? parseFloat(form.interestRate) : undefined,
                repaymentFrequency: form.repaymentFrequency,
              };
              if (property) updateProperty(property.id, payload);
              else addProperty(payload);
              setOpen(false);
              onDone();
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
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{prop?.address}</SheetTitle>
        </SheetHeader>
        {prop && (
          <Tabs defaultValue="details" className="mt-4">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="housekeeping">Housekeeping &amp; Bills</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Purchase price" value={fmtCurrency(prop.purchasePrice)} />
                <Stat label="Current value" value={fmtCurrency(prop.currentValue)} />
                <Stat label="Purchase date" value={prop.purchaseDate || "—"} />
                <Stat label="Tenant code" value={prop.tenantCode || "—"} />
                <Stat label="Loan balance" value={fmtCurrency(prop.loanBalance ?? loan?.totalBalance ?? 0)} />
                <Stat label="Interest rate" value={prop.interestRate ? `${prop.interestRate}%` : "—"} />
                <Stat label="Lender" value={prop.lender || loan?.bankName || "—"} />
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
                  <TenantRow
                    key={t.id}
                    tenant={t}
                    onDelete={() => {
                      if (confirm("Delete tenant and their ledger history?")) {
                        deleteTenant(t.id);
                        toast.success("Tenant removed");
                      }
                    }}
                  />
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
            </TabsContent>
            <TabsContent value="housekeeping">
              <PropertyBillsTab propertyId={prop.id} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PropertyBillsTab({ propertyId }: { propertyId: string }) {
  const { state, addBill, deleteBill, markBillPaid } = useStore();
  const bills = state.bills.filter((b) => b.propertyId === propertyId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    billType: "Water" as BillType,
    amount: "",
    dueDate: todayISO(),
    portalUrl: "",
    portalUsername: "",
    passwordNote: "",
    notes: "",
    recurrenceMonths: "",
  });

  const save = () => {
    if (!form.amount) return toast.error("Amount required");
    addBill({
      propertyId,
      billType: form.billType,
      amount: parseFloat(form.amount) || 0,
      dueDate: form.dueDate,
      status: "Unpaid",
      portalUrl: form.portalUrl || undefined,
      portalUsername: form.portalUsername || undefined,
      passwordNote: form.passwordNote || undefined,
      notes: form.notes || undefined,
      recurrenceMonths: form.recurrenceMonths ? parseInt(form.recurrenceMonths, 10) : undefined,
    });
    setOpen(false);
    setForm({ billType: "Water", amount: "", dueDate: todayISO(), portalUrl: "", portalUsername: "", passwordNote: "", notes: "", recurrenceMonths: "" });
    toast.success("Bill added");
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Utility portal credentials are stored locally in your browser only.
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-3 w-3" /> Add Bill</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader><DialogTitle>New bill</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Bill type">
                <Select value={form.billType} onValueChange={(v) => setForm({ ...form, billType: v as BillType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["Water","Council Rates","Strata","Insurance","Electricity","Gas","Other"] as BillType[]).map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount (AUD)">
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label="Due date">
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </Field>
              <Field label="Recurrence (months)">
                <Input type="number" placeholder="e.g. 3 for quarterly" value={form.recurrenceMonths} onChange={(e) => setForm({ ...form, recurrenceMonths: e.target.value })} />
              </Field>
              <Field label="Portal URL">
                <Input value={form.portalUrl} onChange={(e) => setForm({ ...form, portalUrl: e.target.value })} placeholder="https://…" />
              </Field>
              <Field label="Portal username">
                <Input value={form.portalUsername} onChange={(e) => setForm({ ...form, portalUsername: e.target.value })} />
              </Field>
              <Field label="Password note (stored locally)">
                <Input value={form.passwordNote} onChange={(e) => setForm({ ...form, passwordNote: e.target.value })} />
              </Field>
              <Field label="Notes">
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {bills.length === 0 && (
        <div className="rounded-md border p-4 text-center text-muted-foreground text-xs">
          No bills yet. Add water, rates, strata or insurance bills to track them here.
        </div>
      )}

      {bills.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).map((b) => (
        <BillRow key={b.id} bill={b} onPaid={() => { markBillPaid(b.id); toast.success("Marked paid" + (b.recurrenceMonths ? " — next cycle scheduled" : "")); }} onDelete={() => { deleteBill(b.id); toast.success("Bill removed"); }} />
      ))}
    </div>
  );
}

function BillRow({ bill, onPaid, onDelete }: { bill: PropertyBill; onPaid: () => void; onDelete: () => void }) {
  const overdue = bill.status === "Unpaid" && bill.dueDate < todayISO();
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{bill.billType}</span>
            <Badge variant={bill.status === "Paid" ? "secondary" : overdue ? "destructive" : "outline"}>
              {overdue ? "Overdue" : bill.status}
            </Badge>
            {bill.recurrenceMonths ? <Badge variant="outline">Every {bill.recurrenceMonths}mo</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Due {bill.dueDate} • {fmtCurrency(bill.amount)}
          </div>
          {bill.portalUrl && (
            <a href={bill.portalUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
              Open portal <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {(bill.portalUsername || bill.passwordNote) && (
            <div className="mt-1 text-xs text-muted-foreground">
              {bill.portalUsername && <>User: <span className="font-mono">{bill.portalUsername}</span></>}
              {bill.passwordNote && <> • Note: <span className="font-mono">{bill.passwordNote}</span></>}
            </div>
          )}
          {bill.notes && <div className="mt-1 text-xs">{bill.notes}</div>}
        </div>
        <div className="flex gap-1">
          {bill.status !== "Paid" && (
            <Button size="sm" variant="outline" className="gap-1" onClick={onPaid}>
              <CheckCircle2 className="h-3 w-3" /> Mark Paid
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}



function TenantRow({ tenant, onDelete }: { tenant: Tenant; onDelete: () => void }) {
  const { state } = useStore();
  const history = state.leaseHistory.filter((h) => h.tenantId === tenant.id);
  const rentChanges = state.rentChanges.filter((r) => r.tenantId === tenant.id);
  const [showHist, setShowHist] = useState(false);

  return (
    <div className="mb-2 rounded border p-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium">{tenant.name}</div>
          <div className="text-xs text-muted-foreground">
            {tenant.leaseStart || "—"} → {tenant.leaseExpiry || "Periodic"} •{" "}
            {fmtCurrency(tenant.rentAmount)}/{tenant.rentFrequency}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {tenant.bondAmount ? (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" /> Bond Secured — {fmtCurrency(tenant.bondAmount)}
              </Badge>
            ) : null}
            {tenant.leaseDocumentFileName && (
              <Badge variant="outline" className="gap-1">
                <FileText className="h-3 w-3" /> Lease PDF
              </Badge>
            )}
            {!tenant.leaseExpiry && <Badge variant="outline">Periodic</Badge>}
          </div>
        </div>
        <div className="flex gap-1">
          <RenewLeaseDialog tenant={tenant} />
          <TenantDialog propertyId={tenant.propertyId} tenant={tenant}>
            <Button size="icon" variant="ghost">
              <Pencil className="h-4 w-4" />
            </Button>
          </TenantDialog>
          <Button size="icon" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {(history.length > 0 || rentChanges.length > 0) && (
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setShowHist((v) => !v)}
          >
            <History className="h-3 w-3" /> {showHist ? "Hide" : "Show"} lease &amp; rent history (
            {history.length + rentChanges.length})
          </Button>
          {showHist && (
            <div className="mt-2 space-y-1 rounded bg-muted/50 p-2 text-xs">
              {history.map((h) => (
                <div key={h.id}>
                  Previous lease: {h.pastStartDate} → {h.pastEndDate || "Periodic"} @ {fmtCurrency(h.pastRent)}/
                  {h.pastFrequency}
                </div>
              ))}
              {rentChanges.map((r) => (
                <div key={r.id}>
                  {r.changeDate}: rent {fmtCurrency(r.oldRent)} → {fmtCurrency(r.newRent)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function computeLeaseEnd(start: string, duration: LeaseDuration | ""): string {
  if (!start || !duration || duration === "Periodic") return "";
  const months = duration === "6 Months" ? 6 : 12;
  const d = new Date(start);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function RenewLeaseDialog({ tenant }: { tenant: Tenant }) {
  const { renewLease } = useStore();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [duration, setDuration] = useState<LeaseDuration | "">((tenant.leaseDuration as LeaseDuration) || "12 Months");
  const [end, setEnd] = useState<string>(computeLeaseEnd(today, "12 Months"));
  const [rent, setRent] = useState(tenant.rentAmount.toString());
  const [frequency, setFrequency] = useState<RentFrequency>(tenant.rentFrequency);

  const onStart = (v: string) => {
    setStart(v);
    if (duration && duration !== "Periodic") setEnd(computeLeaseEnd(v, duration));
  };
  const onDuration = (v: LeaseDuration) => {
    setDuration(v);
    if (v === "Periodic") setEnd("");
    else setEnd(computeLeaseEnd(start, v));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Renew lease">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renew lease — {tenant.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New start date">
            <Input type="date" value={start} onChange={(e) => onStart(e.target.value)} />
          </Field>
          <Field label="Duration">
            <Select value={duration || undefined} onValueChange={(v) => onDuration(v as LeaseDuration)}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6 Months">6 Months</SelectItem>
                <SelectItem value="12 Months">12 Months</SelectItem>
                <SelectItem value="Periodic">Periodic / Ongoing</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Calculated end date">
            <Input value={end || "Periodic (no fixed end)"} readOnly className="bg-muted" />
          </Field>
          <Field label="New rent (AUD)">
            <Input type="number" value={rent} onChange={(e) => setRent(e.target.value)} />
          </Field>
          <Field label="Frequency">
            <Select value={frequency} onValueChange={(v) => setFrequency(v as RentFrequency)}>
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
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              renewLease(tenant.id, {
                newStart: start,
                newEnd: end || undefined,
                newDuration: (duration as LeaseDuration) || undefined,
                newRent: parseFloat(rent) || 0,
                newFrequency: frequency,
              });
              setOpen(false);
              toast.success("Lease renewed. Previous lease archived to history.");
            }}
          >
            Confirm Renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { addTenant, updateTenant, state } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: tenant?.name ?? "",
    email: tenant?.email ?? "",
    phone: tenant?.phone ?? "",
    leaseStart: tenant?.leaseStart ?? "",
    leaseExpiry: tenant?.leaseExpiry ?? "",
    leaseDuration: (tenant?.leaseDuration ?? "") as LeaseDuration | "",
    lastRentIncreaseDate: tenant?.lastRentIncreaseDate ?? "",
    rentAmount: tenant?.rentAmount?.toString() ?? "",
    rentFrequency: (tenant?.rentFrequency ?? "Weekly") as RentFrequency,
    bankReference: tenant?.bankReference ?? "",
    bankAccountHolder: tenant?.bankAccountHolder ?? "",
    bondAmount: tenant?.bondAmount?.toString() ?? "",
    bondLodgementDate: tenant?.bondLodgementDate ?? "",
    bondReceiptNumber: tenant?.bondReceiptNumber ?? "",
    leaseDocumentFileName: tenant?.leaseDocumentFileName ?? "",
    leaseDocumentFileData: tenant?.leaseDocumentFileData ?? "",
  });

  const onStart = (v: string) => {
    setForm((s) => ({
      ...s,
      leaseStart: v,
      leaseExpiry:
        s.leaseDuration && s.leaseDuration !== "Periodic" ? computeLeaseEnd(v, s.leaseDuration) : s.leaseExpiry,
    }));
  };
  const onDuration = (v: LeaseDuration) => {
    setForm((s) => ({
      ...s,
      leaseDuration: v,
      leaseExpiry: v === "Periodic" ? "" : computeLeaseEnd(s.leaseStart, v),
    }));
  };
  const onLeaseFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () =>
      setForm((s) => ({ ...s, leaseDocumentFileName: f.name, leaseDocumentFileData: String(reader.result) }));
    reader.readAsDataURL(f);
  };

  const check12Months = () => {
    if (!tenant) return true;
    const oldRent = tenant.rentAmount;
    const newRent = parseFloat(form.rentAmount);
    if (oldRent === newRent) return true;
    const last = state.rentChanges
      .filter((r) => r.tenantId === tenant.id)
      .sort((a, b) => (a.changeDate < b.changeDate ? 1 : -1))[0];
    const baseDate = last?.changeDate ?? tenant.lastRentIncreaseDate ?? tenant.leaseStart ?? "";
    if (!baseDate) return true;
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tenant ? "Edit tenant" : "Onboard tenant"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name *">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Rent amount *">
            <Input
              type="number"
              value={form.rentAmount}
              onChange={(e) => setForm({ ...form, rentAmount: e.target.value })}
            />
          </Field>
          <Field label="Rent frequency *">
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
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Lease start date">
            <Input type="date" value={form.leaseStart} onChange={(e) => onStart(e.target.value)} />
          </Field>
          <Field label="Lease duration">
            <Select value={form.leaseDuration || undefined} onValueChange={(v) => onDuration(v as LeaseDuration)}>
              <SelectTrigger>
                <SelectValue placeholder="Periodic / Ongoing" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6 Months">6 Months</SelectItem>
                <SelectItem value="12 Months">12 Months</SelectItem>
                <SelectItem value="Periodic">Periodic / Ongoing</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Lease end date (auto)">
            <Input
              type="date"
              value={form.leaseExpiry}
              onChange={(e) => setForm({ ...form, leaseExpiry: e.target.value })}
              placeholder="Periodic"
            />
          </Field>
          <Field label="Last rent increase date">
            <Input
              type="date"
              value={form.lastRentIncreaseDate}
              onChange={(e) => setForm({ ...form, lastRentIncreaseDate: e.target.value })}
            />
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
          <Field label="Lease agreement (PDF)">
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => onLeaseFile(e.target.files?.[0])} />
            {form.leaseDocumentFileName && (
              <div className="mt-1 text-xs text-muted-foreground">📎 {form.leaseDocumentFileName}</div>
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!form.name) return toast.error("Name is required");
              if (!form.rentAmount) return toast.error("Rent amount is required");
              if (!check12Months()) return;
              const rentAmount = parseFloat(form.rentAmount) || 0;
              const payload: Omit<Tenant, "id" | "paidUpToDate"> & { paidUpToDate?: string } = {
                name: form.name,
                email: form.email || undefined,
                phone: form.phone || undefined,
                propertyId,
                leaseStart: form.leaseStart || undefined,
                leaseExpiry: form.leaseExpiry || undefined,
                leaseDuration: (form.leaseDuration || undefined) as LeaseDuration | undefined,
                lastRentIncreaseDate: form.lastRentIncreaseDate || undefined,
                rentAmount,
                rentFrequency: form.rentFrequency,
                bankReference: form.bankReference || undefined,
                bankAccountHolder: form.bankAccountHolder || undefined,
                bondAmount: form.bondAmount ? parseFloat(form.bondAmount) : undefined,
                bondLodgementDate: form.bondLodgementDate || undefined,
                bondReceiptNumber: form.bondReceiptNumber || undefined,
                leaseDocumentFileName: form.leaseDocumentFileName || undefined,
                leaseDocumentFileData: form.leaseDocumentFileData || undefined,
                paidUpToDate: tenant?.paidUpToDate ?? form.leaseStart ?? new Date().toISOString().slice(0, 10),
              };
              if (tenant) {
                // rent-change is auto-logged inside updateTenant
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
