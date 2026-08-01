import { useEffect, useMemo, useState } from "react";
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
import {
  Trash2,
  Plus,
  Send,
  Upload,
  Copy,
  SlidersHorizontal,
  CalendarClock,
  FileSignature,
  Mail,
} from "lucide-react";
import {
  buildTenantLedger,
  fmtCurrency,
  todayISO,
  addDays,
  addMonths,
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
      { name: "description", content: "Property-driven daily financial workspace: ledgers, payments and reconciliation." },
    ],
  }),
  component: RentalHubPage,
});

function RentalHubPage() {
  const { state } = useStore();
  const [propertyId, setPropertyId] = useState<string>("");

  // Auto-select first property once state hydrates
  useEffect(() => {
    if (!propertyId && state.properties[0]) setPropertyId(state.properties[0].id);
  }, [state.properties, propertyId]);

  const property = state.properties.find((p) => p.id === propertyId);
  const tenants = useMemo(
    () => state.tenants.filter((t) => t.propertyId === propertyId),
    [state.tenants, propertyId],
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rental Hub</h1>
          <p className="text-sm text-muted-foreground">
            Everything on this page is filtered by the selected property.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="h-9 w-[260px]">
              <SelectValue placeholder="Select a property" />
            </SelectTrigger>
            <SelectContent>
              {state.properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.address}
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
          <BankFeedDialog />
        </div>
      </div>

      {!property && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Add a property in the Portfolio Manager to get started.
          </CardContent>
        </Card>
      )}

      {property && tenants.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No tenants linked to <b>{property.address}</b> yet. Use Quick-Add Tenant above.
          </CardContent>
        </Card>
      )}

      {tenants.map((t) => (
        <div key={t.id} className="space-y-4">
          <TenantSummaryCard tenant={t} propertyAddress={property?.address} />
          <TenantLedgerCard tenant={t} />
        </div>
      ))}
    </div>
  );
}

function TenantSummaryCard({ tenant, propertyAddress }: { tenant: Tenant; propertyAddress?: string }) {
  const [noticeOpen, setNoticeOpen] = useState<null | TemplateKey>(null);
  const nextIncreaseDue = (() => {
    const base = tenant.lastRentIncreaseDate ?? tenant.leaseStart;
    if (!base) return null;
    return addMonths(base, 12);
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>{tenant.name}</span>
          <span className="text-xs font-normal text-muted-foreground">{propertyAddress}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Lease start" value={tenant.leaseStart || "—"} />
          <Stat label="Lease end" value={tenant.leaseExpiry || "Periodic"} />
          <Stat label="Last rent increase" value={tenant.lastRentIncreaseDate || "—"} />
          <Stat label="Next increase eligible" value={nextIncreaseDue || "—"} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setNoticeOpen("renewal")}
          >
            <FileSignature className="h-3.5 w-3.5" /> Send Lease Renewal Offer
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setNoticeOpen("arrears")}
          >
            <Mail className="h-3.5 w-3.5" /> Generate Arrears Notice
          </Button>
          <RentIncreaseLetterButton tenant={tenant} propertyAddress={propertyAddress} />
        </div>
        <Dialog open={!!noticeOpen} onOpenChange={(o) => !o && setNoticeOpen(null)}>
          {noticeOpen && (
            <TemplateModal
              tenant={tenant}
              outstanding={0}
              property={propertyAddress}
              defaultKey={noticeOpen}
            />
          )}
        </Dialog>
      </CardContent>
    </Card>
  );
}

function RentIncreaseLetterButton({ tenant, propertyAddress }: { tenant: Tenant; propertyAddress?: string }) {
  const [open, setOpen] = useState(false);
  const [newRent, setNewRent] = useState((tenant.rentAmount * 1.05).toFixed(0));
  const [effective, setEffective] = useState(addDays(todayISO(), 60));

  const body = `Dear ${tenant.name},

We are writing to give you formal notice of a rent adjustment at ${propertyAddress ?? "your rental property"}.

Current rent: ${fmtCurrency(tenant.rentAmount)} / ${tenant.rentFrequency}
New rent: ${fmtCurrency(parseFloat(newRent) || 0)} / ${tenant.rentFrequency}
Effective from: ${effective}

This notice is issued in accordance with your tenancy agreement and relevant state legislation. Please let us know if you have any questions.

Kind regards,
The Landlord`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <CalendarClock className="h-3.5 w-3.5" /> Generate Rent Increase Letter
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rent increase letter — {tenant.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">New rent (AUD)</Label>
            <Input type="number" value={newRent} onChange={(e) => setNewRent(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Effective from</Label>
            <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
          </div>
        </div>
        <Textarea className="min-h-[240px] font-mono text-xs" value={body} readOnly />
        <DialogFooter>
          <Button
            className="gap-1"
            onClick={() => {
              navigator.clipboard.writeText(body);
              toast.success("Letter copied to clipboard");
            }}
          >
            <Copy className="h-4 w-4" /> Copy to clipboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TenantLedgerCard({ tenant }: { tenant: Tenant }) {
  const { state, addLedger, deleteLedger } = useStore();
  const { rows, total, outstandingRent, outstandingInvoices } = buildTenantLedger(
    tenant,
    state.ledger,
    state.invoices,
  );
  const [amount, setAmount] = useState("");

  const nextDue = addDays(tenant.paidUpToDate, 1);
  const propertyAddress = state.properties.find((p) => p.id === tenant.propertyId)?.address ?? "";

  const postPayment = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return toast.error("Enter a valid amount");
    const rate = dailyRentRate(tenant.rentAmount, tenant.rentFrequency);
    // 1 week (weekly rent) = 7 days; 9 weeks = 63 days. Never off-by-one.
    const daysCovered = Math.floor(val / rate);
    // The store re-derives paidUpToDate from lease start + all rent credits.
    addLedger({
      tenantId: tenant.id,
      date: todayISO(),
      type: "Rent Payment",
      description: `Payment received (${daysCovered} days)`,
      debit: 0,
      credit: val,
    });
    setAmount("");
    toast.success(`Posted ${fmtCurrency(val)} — paid-up date recalculated (${daysCovered} days).`);
  };

  const removePayment = (id: string) => {
    deleteLedger(id);
    toast.success("Ledger entry reversed — paid-up date recalculated");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>Ledger — {fmtCurrency(tenant.rentAmount)}/{tenant.rentFrequency}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={total > 0 ? "destructive" : "secondary"}>
              {total > 0 ? `Owes ${fmtCurrency(total)}` : "Up to date"}
            </Badge>
            <TenantDialog propertyId={tenant.propertyId} tenant={tenant}>
              <Button size="sm" variant="outline">
                Edit Tenant Details
              </Button>
            </TenantDialog>
            <AdjustmentDialog tenant={tenant} />
            <LedgerExportButtons
              tenant={tenant}
              propertyAddress={propertyAddress}
              rows={rows}
              total={total}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Paid up to" value={tenant.paidUpToDate} />
          <Stat label="Next rent due" value={nextDue} />
          <Stat label="Rent arrears" value={fmtCurrency(outstandingRent)} />
          <Stat label="Invoices outstanding" value={fmtCurrency(outstandingInvoices)} />
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
                  <td className="px-3 py-2 text-right text-emerald-600">
                    {r.credit ? fmtCurrency(r.credit) : ""}
                  </td>
                  <td
                    className={
                      "px-3 py-2 text-right font-medium " +
                      (r.balance > 0 ? "text-destructive" : "text-emerald-600")
                    }
                  >
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

function AdjustmentDialog({ tenant }: { tenant: Tenant }) {
  const { addLedger } = useStore();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"Credit" | "Debit">("Credit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());

  const post = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return toast.error("Enter a valid amount");
    if (!description) return toast.error("Description required");
    addLedger({
      tenantId: tenant.id,
      date,
      type: kind === "Credit" ? "Adjustment Credit" : "Adjustment Debit",
      description: `Adjustment: ${description}`,
      debit: kind === "Debit" ? val : 0,
      credit: kind === "Credit" ? val : 0,
      manual: true,
    });
    setOpen(false);
    setAmount("");
    setDescription("");
    toast.success(`One-off ${kind.toLowerCase()} adjustment posted`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <SlidersHorizontal className="h-3 w-3" /> Add Adjustment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>One-off ledger adjustment</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Modifies this billing cycle's running balance only. Does not change the tenant's base rent.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "Credit" | "Debit")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Credit">Credit (reduce balance owed)</SelectItem>
                <SelectItem value="Debit">Debit (charge tenant)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Amount (AUD)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Description</Label>
            <Input
              placeholder="e.g. 1-week rent reduction while hot water repaired"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={post}>Post Adjustment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
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
  defaultKey,
}: {
  tenant: Tenant;
  outstanding: number;
  property?: string;
  defaultKey?: TemplateKey;
}) {
  const [tpl, setTpl] = useState<TemplateKey>(defaultKey ?? "arrears");
  const text = renderTemplate(tpl, {
    tenant,
    property: property
      ? ({ id: "", address: property, purchasePrice: 0, currentValue: 0 } as any)
      : undefined,
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

function LedgerExportButtons({
  tenant,
  propertyAddress,
  rows,
  total,
}: {
  tenant: Tenant;
  propertyAddress: string;
  rows: LedgerRow[];
  total: number;
}) {
  const header = ["Date", "Description", "Debit", "Credit", "Balance"];

  const toCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    return [
      header.map(esc).join(","),
      ...rows.map((r) => [r.date, r.description, r.debit, r.credit, r.balance].map(esc).join(",")),
    ].join("\n");
  };

  const downloadCsv = () => {
    const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${tenant.name.replace(/\s+/g, "-").toLowerCase()}-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Ledger CSV downloaded");
  };

  const downloadPdf = () => {
    const win = window.open("", "_blank");
    if (!win) return toast.error("Allow pop-ups to export the PDF");
    win.document.write(`<!doctype html><html><head><title>Ledger — ${tenant.name}</title>
      <style>
        body{font-family:ui-sans-serif,system-ui,sans-serif;padding:32px;color:#111}
        h1{font-size:18px;margin:0 0 4px} p{font-size:12px;color:#555;margin:0 0 16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left}
        td.num,th.num{text-align:right}
        tfoot td{font-weight:600}
      </style></head><body>
      <h1>Tenant Statement — ${tenant.name}</h1>
      <p>${propertyAddress} • Rent ${fmtCurrency(tenant.rentAmount)} / ${tenant.rentFrequency} • Paid up to ${tenant.paidUpToDate} • Generated ${todayISO()}</p>
      <table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><td>${r.date}</td><td>${r.description}</td><td class="num">${r.debit ? fmtCurrency(r.debit) : ""}</td><td class="num">${r.credit ? fmtCurrency(r.credit) : ""}</td><td class="num">${fmtCurrency(r.balance)}</td></tr>`,
        )
        .join("")}</tbody>
      <tfoot><tr><td colspan="4">Total outstanding</td><td class="num">${fmtCurrency(total)}</td></tr></tfoot>
      </table></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const emailLedger = () => {
    const lines = rows
      .map((r) => `${r.date} | ${r.description} | Dr ${r.debit} | Cr ${r.credit} | Bal ${r.balance}`)
      .join("\n");
    const body = `Dear ${tenant.name},\n\nPlease find your rent ledger for ${propertyAddress} below.\n\n${lines}\n\nTotal outstanding: ${fmtCurrency(total)}\nPaid up to: ${tenant.paidUpToDate}\n\nKind regards,\nThe Landlord`;
    window.location.href = `mailto:${tenant.email ?? ""}?subject=${encodeURIComponent(
      `Rent ledger — ${propertyAddress}`,
    )}&body=${encodeURIComponent(body)}`;
  };

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1" onClick={downloadCsv}>
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>
      <Button size="sm" variant="outline" className="gap-1" onClick={downloadPdf}>
        <FileDown className="h-3.5 w-3.5" /> PDF
      </Button>
      <Button size="sm" variant="outline" className="gap-1" onClick={emailLedger}>
        <Send className="h-3.5 w-3.5" /> Email
      </Button>
    </>
  );
}

function BankFeedDialog() {
  const { state, addLedger } = useStore();

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
    addLedger({
      tenantId: m.tenant.id,
      date: todayISO(),
      type: "Rent Payment",
      description: `Bank feed match (${daysCovered} days)`,
      debit: 0,
      credit: m.amount,
    });

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
