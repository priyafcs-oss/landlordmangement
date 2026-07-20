import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Send, Upload, Copy, FileText } from "lucide-react";
import {
  buildTenantLedger,
  fmtCurrency,
  todayISO,
  addDays,
  dailyRentRate,
} from "@/lib/calculations";
import type { Tenant } from "@/lib/types";
import { toast } from "sonner";
import { TenantDialog } from "./portfolio";
import { TEMPLATES, renderTemplate, type TemplateKey } from "@/lib/templates";

export const Route = createFileRoute("/rental")({
  head: () => ({
    meta: [
      { title: "Rental Hub — Landlord OS" },
      { name: "description", content: "Daily financial workspace: ledgers, payments and bank reconciliation." },
    ],
  }),
  component: RentalHubPage,
});

function RentalHubPage() {
  const { state } = useStore();
  const [selected, setSelected] = useState<string | "all">("all");

  const tenantStatuses = useMemo(() => {
    return state.tenants.map((t) => {
      const { total } = buildTenantLedger(t, state.ledger, state.invoices);
      return { tenant: t, arrears: total > 0.01, total };
    });
  }, [state]);

  const activeTenants = selected === "all" ? state.tenants : state.tenants.filter((t) => t.id === selected);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      {/* Directory sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-muted/30 md:block">
        <div className="border-b p-3">
          <Button variant="outline" size="sm" className="w-full" onClick={() => setSelected("all")}>
            Show All Tenants
          </Button>
        </div>
        <div className="overflow-y-auto p-2 text-sm">
          {tenantStatuses.map(({ tenant, arrears }) => (
            <button
              key={tenant.id}
              onClick={() => setSelected(tenant.id)}
              className={
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent " +
                (selected === tenant.id ? "bg-accent" : "")
              }
            >
              <span
                className={
                  "h-2 w-2 shrink-0 rounded-full " + (arrears ? "bg-red-500" : "bg-emerald-500")
                }
              />
              <span className="truncate">{tenant.name}</span>
            </button>
          ))}
          {state.tenants.length === 0 && (
            <div className="p-2 text-xs text-muted-foreground">No tenants yet.</div>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Rental Hub</h1>
            <p className="text-sm text-muted-foreground">Ledgers, arrears and payment reconciliation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuickAddTenant />
            <BankFeedDialog />
          </div>
        </div>

        {/* Mobile filter chips */}
        <div className="flex gap-2 overflow-x-auto md:hidden">
          <Button variant={selected === "all" ? "default" : "outline"} size="sm" onClick={() => setSelected("all")}>
            All
          </Button>
          {tenantStatuses.map(({ tenant, arrears }) => (
            <Button
              key={tenant.id}
              size="sm"
              variant={selected === tenant.id ? "default" : "outline"}
              onClick={() => setSelected(tenant.id)}
              className="gap-1 whitespace-nowrap"
            >
              <span className={"h-2 w-2 rounded-full " + (arrears ? "bg-red-500" : "bg-emerald-500")} />
              {tenant.name}
            </Button>
          ))}
        </div>

        {activeTenants.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No tenants to display. Add a tenant to see their ledger.
            </CardContent>
          </Card>
        )}

        {activeTenants.map((t) => (
          <TenantLedgerCard key={t.id} tenant={t} />
        ))}
      </div>
    </div>
  );
}

function QuickAddTenant() {
  const { state } = useStore();
  const [propertyId, setPropertyId] = useState(state.properties[0]?.id ?? "");
  if (state.properties.length === 0) return null;
  return (
    <div className="flex gap-2">
      <Select value={propertyId} onValueChange={setPropertyId}>
        <SelectTrigger className="h-9 w-[160px]">
          <SelectValue placeholder="Property" />
        </SelectTrigger>
        <SelectContent>
          {state.properties.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.address.slice(0, 30)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {propertyId && (
        <TenantDialog propertyId={propertyId}>
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Quick-Add Tenant
          </Button>
        </TenantDialog>
      )}
    </div>
  );
}

function TenantLedgerCard({ tenant }: { tenant: Tenant }) {
  const { state, addLedger, deleteLedger, updateTenant } = useStore();
  const property = state.properties.find((p) => p.id === tenant.propertyId);
  const { rows, total, outstandingRent, outstandingInvoices } = buildTenantLedger(
    tenant,
    state.ledger,
    state.invoices,
  );
  const [amount, setAmount] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);

  const nextDue = addDays(tenant.paidUpToDate, 1);

  const postPayment = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return toast.error("Enter a valid amount");
    const rate = dailyRentRate(tenant.rentAmount, tenant.rentFrequency);
    const daysCovered = Math.floor(val / rate);
    const newPaidUpTo = addDays(tenant.paidUpToDate, daysCovered);
    addLedger({
      tenantId: tenant.id,
      date: todayISO(),
      type: "Rent Payment",
      description: `Payment received (${daysCovered} days)`,
      debit: 0,
      credit: val,
      newPaidUpToDate: newPaidUpTo,
    });
    updateTenant(tenant.id, { paidUpToDate: newPaidUpTo });
    setAmount("");
    toast.success(`Posted ${fmtCurrency(val)}. Paid to ${newPaidUpTo}.`);
  };

  const removePayment = (id: string) => {
    const entry = state.ledger.find((e) => e.id === id);
    if (!entry) return;
    if (entry.type === "Rent Payment") {
      const rate = dailyRentRate(tenant.rentAmount, tenant.rentFrequency);
      const daysBack = Math.floor(entry.credit / rate);
      updateTenant(tenant.id, { paidUpToDate: addDays(tenant.paidUpToDate, -daysBack) });
    }
    deleteLedger(id);
    toast.success("Ledger entry reversed");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{tenant.name}</CardTitle>
            <div className="text-xs text-muted-foreground">
              {property?.address} • {fmtCurrency(tenant.rentAmount)}/{tenant.rentFrequency}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={total > 0 ? "destructive" : "secondary"}>
              {total > 0 ? `Owes ${fmtCurrency(total)}` : "Up to date"}
            </Badge>
            <TenantDialog propertyId={tenant.propertyId} tenant={tenant}>
              <Button size="sm" variant="outline">
                Edit Tenant Details
              </Button>
            </TenantDialog>
            <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1">
                  <Send className="h-3 w-3" /> Generate Notice
                </Button>
              </DialogTrigger>
              <TemplateModal tenant={tenant} outstanding={total} property={property?.address} />
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <MiniStat label="Paid up to" value={tenant.paidUpToDate} />
          <MiniStat label="Next rent due" value={nextDue} />
          <MiniStat label="Rent arrears" value={fmtCurrency(outstandingRent)} />
          <MiniStat label="Invoices outstanding" value={fmtCurrency(outstandingInvoices)} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Payment amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="max-w-[180px]"
          />
          <Button onClick={postPayment}>Post Payment</Button>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    No transactions yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className={"border-t " + (r.isDue ? "bg-muted/30" : "")}>
                  <td className="px-3 py-2 text-xs">{r.date}</td>
                  <td className="px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 text-right">{r.debit ? fmtCurrency(r.debit) : ""}</td>
                  <td className="px-3 py-2 text-right text-emerald-600">{r.credit ? fmtCurrency(r.credit) : ""}</td>
                  <td className={"px-3 py-2 text-right font-medium " + (r.balance > 0 ? "text-destructive" : "text-emerald-600")}>
                    {fmtCurrency(r.balance)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.canDelete && r.entryId && (
                      <Button size="icon" variant="ghost" onClick={() => removePayment(r.entryId!)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted p-3 text-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function TemplateModal({
  tenant,
  outstanding,
  property,
}: {
  tenant: Tenant;
  outstanding: number;
  property?: string;
}) {
  const [tpl, setTpl] = useState<TemplateKey>("arrears");
  const text = renderTemplate(tpl, {
    tenant,
    property: property ? ({ id: "", address: property, purchasePrice: 0, currentValue: 0 } as any) : undefined,
    outstanding,
  });
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Generate tenant notice</DialogTitle>
      </DialogHeader>
      <Select value={tpl} onValueChange={(v) => setTpl(v as TemplateKey)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TEMPLATES.map((t) => (
            <SelectItem key={t.key} value={t.key}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea className="min-h-[240px] font-mono text-xs" value={text} readOnly />
      <DialogFooter>
        <Button
          onClick={() => {
            navigator.clipboard.writeText(text);
            toast.success("Copied to clipboard");
          }}
          className="gap-1"
        >
          <Copy className="h-4 w-4" /> Copy to clipboard
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function BankFeedDialog() {
  const { state, addLedger, updateTenant } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<{ tenant: Tenant; amount: number; line: string }[]>([]);
  const [confirming, setConfirming] = useState<{ tenant: Tenant; amount: number } | null>(null);

  const parse = () => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const found: { tenant: Tenant; amount: number; line: string }[] = [];
    for (const line of lines) {
      const moneyMatch = line.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
      if (!moneyMatch) continue;
      const amount = parseFloat(moneyMatch[1]);
      if (!amount) continue;
      const lower = line.toLowerCase();
      const tenant = state.tenants.find((t) => {
        const ref = (t.bankReference ?? "").toLowerCase();
        if (ref && lower.includes(ref)) return true;
        const parts = t.name.toLowerCase().split(/\s+/);
        return parts.some((p) => p.length > 2 && lower.includes(p));
      });
      if (tenant) found.push({ tenant, amount, line });
    }
    if (found.length === 0) toast.error("No matches found");
    setMatches(found);
  };

  const handleFile = async (f: File) => {
    const t = await f.text();
    setText(t);
    toast.success("CSV loaded");
  };

  const post = (m: { tenant: Tenant; amount: number }) => {
    const rate = dailyRentRate(m.tenant.rentAmount, m.tenant.rentFrequency);
    const daysCovered = Math.floor(m.amount / rate);
    const newPaid = addDays(m.tenant.paidUpToDate, daysCovered);
    addLedger({
      tenantId: m.tenant.id,
      date: todayISO(),
      type: "Rent Payment",
      description: `Bank feed match (${daysCovered} days)`,
      debit: 0,
      credit: m.amount,
      newPaidUpToDate: newPaid,
    });
    updateTenant(m.tenant.id, { paidUpToDate: newPaid });
    setMatches((ms) => ms.filter((x) => x !== m));
    setConfirming(null);
    toast.success(`Posted ${fmtCurrency(m.amount)} to ${m.tenant.name}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Upload className="h-4 w-4" /> Bank Feed Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bank feed reconciliation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label className="text-xs">Paste bank feed lines or upload CSV</Label>
          <Textarea
            placeholder="e.g. 2026-07-01 REF-SK-2026 Sarah Kim $720.00"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[120px] font-mono text-xs"
          />
          <div className="flex gap-2">
            <Input
              type="file"
              accept=".csv,text/csv,.txt"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="max-w-xs"
            />
            <Button onClick={parse}>Parse</Button>
          </div>
          {matches.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Matches</div>
              {matches.map((m, i) => (
                <div key={i} className="flex items-center justify-between rounded border p-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {fmtCurrency(m.amount)} → {m.tenant.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.line}</div>
                  </div>
                  <Button size="sm" onClick={() => setConfirming(m)}>
                    Post
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        {confirming && (
          <Dialog open onOpenChange={() => setConfirming(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm match</DialogTitle>
              </DialogHeader>
              <p className="text-sm">
                Confirm matching {fmtCurrency(confirming.amount)} to {confirming.tenant.name}?
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
                <Button onClick={() => post(confirming)}>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
