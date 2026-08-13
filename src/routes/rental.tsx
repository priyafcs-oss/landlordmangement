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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  Download,
  FileDown,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  buildTenantLedger,
  fmtCurrency,
  todayISO,
  addDays,
  addMonths,
  dailyRentRate,
  paidUpToDetails,
  ausFinancialYear,
  fyRange,
  type LedgerRow,
} from "@/lib/calculations";
import type { Tenant } from "@/lib/types";

import { toast } from "sonner";
import jsPDF from "jspdf";
import { downloadPdfAndEmailViaGmail } from "@/lib/emailPdf";
import { TenantDialog, IncreaseRentDialog } from "./portfolio";
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

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual entry",
  bank_feed: "Bank feed",
  rent_statement: "Rent statement",
};

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

function LedgerRowsTable({ rows, onDelete }: { rows: LedgerRow[]; onDelete: (id: string) => void }) {
  return (
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
                No transactions in this period.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className={"border-t " + (r.isDue ? "bg-muted/30" : "")}>
              <td className="px-3 py-2 text-xs">{r.date}</td>
              <td className="px-3 py-2">
                {r.description}
                {r.source && r.source !== "manual" && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {SOURCE_LABELS[r.source] ?? r.source}
                  </Badge>
                )}
              </td>
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
                  <Button size="icon" variant="ghost" onClick={() => onDelete(r.entryId!)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerGroupSection({
  label,
  rows,
  onDelete,
}: {
  label: string;
  rows: LedgerRow[];
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const subtotal = rows.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 },
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm">
          <span className="flex items-center gap-2 font-medium">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {label}
          </span>
          <span className="flex gap-3 text-xs text-muted-foreground">
            <span>Debit {fmtCurrency(subtotal.debit)}</span>
            <span className="text-emerald-600">Credit {fmtCurrency(subtotal.credit)}</span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-2">
        <LedgerRowsTable rows={rows} onDelete={onDelete} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function LedgerTotalsFooter({ debit, credit }: { debit: number; credit: number }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-4 rounded border bg-muted/50 p-3 text-sm font-medium">
      <span>Total Debit: {fmtCurrency(debit)}</span>
      <span className="text-emerald-600">Total Credit: {fmtCurrency(credit)}</span>
      <span>Net: {fmtCurrency(debit - credit)}</span>
    </div>
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
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [fy, setFy] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy">("month");

  const nextDue = addDays(tenant.paidUpToDate, 1);
  const propertyAddress = state.properties.find((p) => p.id === tenant.propertyId)?.address ?? "";
  const paidUpTo = paidUpToDetails(tenant, state.ledger);

  const fyOptions = useMemo(() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 5; y <= currentYear + 1; y++) years.push(`${y}-${y + 1}`);
    return years;
  }, []);

  // Filtering/grouping only affects what's displayed/exported — arrears Stats above always
  // reflect the tenant's full unfiltered history.
  const filteredRows = useMemo(() => {
    if (fy === "all") return rows;
    const { start, end } = fyRange(fy);
    return rows.filter((r) => r.date >= start && r.date <= end);
  }, [rows, fy]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
        { debit: 0, credit: 0 },
      ),
    [filteredRows],
  );

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, LedgerRow[]>();
    for (const r of filteredRows) {
      const key = groupBy === "month" ? r.date.slice(0, 7) : ausFinancialYear(r.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [filteredRows, groupBy]);

  const postPayment = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return toast.error("Enter a valid amount");
    if (!paymentDate) return toast.error("Enter the date the payment was received");
    const rate = dailyRentRate(tenant.rentAmount, tenant.rentFrequency);
    // 1 week (weekly rent) = 7 days; 9 weeks = 63 days. Never off-by-one.
    const daysCovered = Math.floor(val / rate);
    // The store re-derives paidUpToDate from lease start + all rent credits.
    addLedger({
      tenantId: tenant.id,
      date: paymentDate,
      type: "Rent Payment",
      description: `Payment received (${daysCovered} days)`,
      debit: 0,
      credit: val,
      source: "manual",
    });
    setAmount("");
    setPaymentDate(todayISO());
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
            <IncreaseRentDialog
              tenant={tenant}
              trigger={
                <Button size="sm" variant="outline" className="gap-1">
                  <TrendingUp className="h-3.5 w-3.5" /> Increase Rent
                </Button>
              }
            />
            <AdjustmentDialog tenant={tenant} />
            <LedgerExportButtons
              tenant={tenant}
              propertyAddress={propertyAddress}
              rows={filteredRows}
              total={total}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="Paid up to"
            value={
              paidUpTo.extra > 0
                ? `${tenant.paidUpToDate} + ${fmtCurrency(paidUpTo.extra)} extra`
                : tenant.paidUpToDate
            }
          />
          <Stat label="Next rent due" value={nextDue} />
          <Stat label="Rent arrears" value={fmtCurrency(outstandingRent)} />
          <Stat label="Invoices outstanding" value={fmtCurrency(outstandingInvoices)} />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Payment amount</Label>
            <Input
              placeholder="Payment amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-[180px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date received</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="max-w-[180px]"
            />
          </div>
          <Button onClick={postPayment}>Post Payment</Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Financial year</Label>
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                {fyOptions.map((y) => (
                  <SelectItem key={y} value={y}>
                    FY {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Group by</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="month">By month</SelectItem>
                <SelectItem value="fy">By financial year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {groupBy === "none" || !groups ? (
          <LedgerRowsTable rows={filteredRows} onDelete={removePayment} />
        ) : (
          <div className="space-y-2">
            {groups.length === 0 && (
              <div className="rounded border p-4 text-center text-sm text-muted-foreground">
                No transactions in this period.
              </div>
            )}
            {groups.map(([key, groupRows]) => (
              <LedgerGroupSection
                key={key}
                label={groupBy === "month" ? formatMonthLabel(key) : `FY ${key}`}
                rows={groupRows}
                onDelete={removePayment}
              />
            ))}
          </div>
        )}

        <LedgerTotalsFooter debit={totals.debit} credit={totals.credit} />
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
      source: "manual",
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

/**
 * jsPDF's built-in "helvetica" font only supports WinAnsi encoding. Intl.NumberFormat (used by
 * fmtCurrency) renders negative amounts with a Unicode minus sign (U+2212) rather than an ASCII
 * hyphen, which that font has no glyph for — it renders as garbled/garbage characters. Normalize
 * before every doc.text() call rather than changing fmtCurrency itself, which is correct
 * everywhere else it's used (real HTML, where the browser renders Unicode fine).
 */
function pdfSafe(s: string): string {
  return s.replace(/−/g, "-").replace(/ /g, " ");
}

function sourceTag(r: LedgerRow): string {
  if (!r.source || r.source === "manual") return "";
  return ` [${SOURCE_LABELS[r.source] ?? r.source}]`;
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
  const header = ["Date", "Description", "Debit", "Credit", "Balance", "Source"];

  const toCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    return [
      header.map(esc).join(","),
      ...rows.map((r) =>
        [r.date, r.description, r.debit, r.credit, r.balance, r.source ? SOURCE_LABELS[r.source] ?? r.source : ""]
          .map(esc)
          .join(","),
      ),
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

  const ledgerFileName = `ledger-${tenant.name.replace(/\s+/g, "-").toLowerCase()}-${todayISO()}.pdf`;

  const buildPdf = () => {
    const doc = new jsPDF();
    const marginX = 14;
    const rightEdge = 196;
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = 18;

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafe(`Tenant Statement - ${tenant.name}`), marginX, y);
    y += 7;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(85);
    doc.text(
      pdfSafe(
        `${propertyAddress} - Rent ${fmtCurrency(tenant.rentAmount)} / ${tenant.rentFrequency} - Paid up to ${tenant.paidUpToDate} - Generated ${todayISO()}`,
      ),
      marginX,
      y,
    );
    y += 8;

    const col = { date: marginX, desc: marginX + 24, debit: marginX + 112, credit: marginX + 142, balance: marginX + 172 };

    const drawHeader = () => {
      doc.setFontSize(9);
      doc.setTextColor(17);
      doc.setFont("helvetica", "bold");
      doc.text("Date", col.date, y);
      doc.text("Description", col.desc, y);
      doc.text("Debit", col.debit, y);
      doc.text("Credit", col.credit, y);
      doc.text("Balance", col.balance, y);
      y += 2;
      doc.setDrawColor(229);
      doc.line(marginX, y, rightEdge, y);
      y += 5;
      doc.setFont("helvetica", "normal");
    };

    drawHeader();
    let sumDebit = 0;
    let sumCredit = 0;
    rows.forEach((r) => {
      sumDebit += r.debit;
      sumCredit += r.credit;
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 18;
        drawHeader();
      }
      doc.text(r.date, col.date, y);
      doc.text(pdfSafe((r.description + sourceTag(r)).slice(0, 48)), col.desc, y);
      doc.text(r.debit ? pdfSafe(fmtCurrency(r.debit)) : "", col.debit, y);
      doc.text(r.credit ? pdfSafe(fmtCurrency(r.credit)) : "", col.credit, y);
      doc.text(pdfSafe(fmtCurrency(r.balance)), col.balance, y);
      y += 6;
    });

    y += 2;
    doc.setDrawColor(229);
    doc.line(marginX, y, rightEdge, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(17);
    doc.text("Totals", col.desc, y);
    doc.text(pdfSafe(fmtCurrency(sumDebit)), col.debit, y);
    doc.text(pdfSafe(fmtCurrency(sumCredit)), col.credit, y);
    y += 7;
    doc.text("Total outstanding", col.desc, y);
    doc.text(pdfSafe(fmtCurrency(total)), col.balance, y);

    return doc;
  };

  const downloadPdf = () => {
    buildPdf().save(ledgerFileName);
    toast.success("Ledger PDF downloaded");
  };

  const emailLedger = () => {
    // No email link (mailto: or a provider's compose URL) can attach a file — that's a browser
    // security restriction, not something any web app can work around. Best available flow:
    // download the PDF so it's ready in Downloads, and open Gmail's web compose (rather than
    // mailto:, which opens whatever the OS has registered — Outlook here) prefilled with a note
    // to attach it.
    const blob = buildPdf().output("blob");
    const body = `Dear ${tenant.name},\n\nPlease find your rent ledger statement for ${propertyAddress} attached to this email — I've just downloaded it as a PDF; please attach the file (from your Downloads) before sending.\n\nTotal outstanding: ${fmtCurrency(total)}\nPaid up to: ${tenant.paidUpToDate}\n\nKind regards,\nThe Landlord`;
    downloadPdfAndEmailViaGmail({
      blob,
      fileName: ledgerFileName,
      to: tenant.email,
      subject: `Rent ledger — ${propertyAddress}`,
      body,
    });
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
      source: "bank_feed",
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
