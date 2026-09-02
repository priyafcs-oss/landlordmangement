import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stat } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  FileUp,
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
  History,
  RefreshCw,
  IdCard,
  ShieldCheck,
  FileText,
  TriangleAlert,
  Pencil,
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
import type { Tenant, Property } from "@/lib/types";

import { toast } from "sonner";
import { MAX_AI_UPLOAD_BYTES, formatFileSize } from "@/lib/files";
import { DocumentLink } from "@/components/DocumentLink";
import jsPDF from "jspdf";
import { downloadPdfAndEmailViaGmail, openGmailCompose } from "@/lib/emailPdf";
import { downloadCsv } from "@/lib/csv";
import { supabase } from "@/integrations/supabase/client";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import {
  TenantDialog,
  IncreaseRentDialog,
  RenewLeaseDialog,
  DeleteTenantDialog,
  LeaseAgreementWizard,
  RentChangeRow,
  LeaseHistoryRow,
} from "@/components/PropertyShared";
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

  // When a property has more than one tenant, showing every tenant's full ledger stacked at
  // once makes the page unusably long — switch to one-tenant-at-a-time via tabs instead.
  const [activeTenantId, setActiveTenantId] = useState<string>("");
  useEffect(() => {
    if (tenants.length > 0 && !tenants.some((t) => t.id === activeTenantId)) {
      setActiveTenantId(tenants[0].id);
    }
  }, [tenants, activeTenantId]);
  const visibleTenants = tenants.length > 1 ? tenants.filter((t) => t.id === activeTenantId) : tenants;

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
          {property && (
            <LeaseAgreementWizard property={property}>
              <Button size="sm" variant="outline" className="gap-1">
                <FileSignature className="h-4 w-4" /> Create Tenancy Agreement
              </Button>
            </LeaseAgreementWizard>
          )}
          {propertyId && (
            <TenantDialog propertyId={propertyId}>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> Quick-Add Tenant
              </Button>
            </TenantDialog>
          )}
          <BankFeedDialog />
          <UploadDocumentDialog />
        </div>
      </div>

      {!property && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Add a property in Assets to get started.
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

      {tenants.length > 1 && (
        <Tabs value={activeTenantId} onValueChange={setActiveTenantId}>
          <TabsList className="flex-wrap">
            {tenants.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.name} — {fmtCurrency(t.rentAmount)}/{t.rentFrequency}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {visibleTenants.map((t) => (
        <div key={t.id} className="space-y-4">
          <TenantSummaryCard tenant={t} property={property} />
          <TenantLedgerCard tenant={t} />
        </div>
      ))}
    </div>
  );
}

function TenantSummaryCard({ tenant, property }: { tenant: Tenant; property?: Property }) {
  const { state, convertToPeriodic } = useStore();
  const [noticeOpen, setNoticeOpen] = useState<null | TemplateKey>(null);
  const [showHist, setShowHist] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const propertyAddress = tenant.unitAddress || property?.address;
  const history = state.leaseHistory.filter((h) => h.tenantId === tenant.id);
  const rentChanges = state.rentChanges.filter((r) => r.tenantId === tenant.id);
  const latestRentChange = [...rentChanges].sort((a, b) => (a.changeDate < b.changeDate ? 1 : -1))[0];
  const isExpiredFixedTerm =
    !!tenant.leaseExpiry && tenant.leaseExpiry < todayISO() && tenant.leaseDuration !== "Periodic";
  const hasLeaseDoc = tenant.leaseDocumentFileName && tenant.leaseDocumentFileData;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <span>{tenant.name}</span>
          {tenant.bondAmount ? (
            <Badge variant="secondary" className="gap-1 font-normal">
              <ShieldCheck className="h-3 w-3" /> Bond Secured — {fmtCurrency(tenant.bondAmount)}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Lease start</div>
            <div className="mt-0.5 font-medium">{tenant.leaseStart || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Lease end</div>
            <div className="mt-0.5 font-medium">{tenant.leaseExpiry || "Periodic"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Last rent increase</div>
            <div className="mt-0.5 font-medium">{tenant.lastRentIncreaseDate || "—"}</div>
          </div>
        </div>

        {(tenant.idProofFileName || tenant.bondTransferFileName || latestRentChange) && (
          <div className="flex flex-wrap items-center gap-1">
            {tenant.idProofFileName && tenant.idProofFileData && (
              <DocumentLink fileName={tenant.idProofFileName} fileData={tenant.idProofFileData}>
                <Badge variant="outline" className="gap-1">
                  <IdCard className="h-3 w-3" /> ID Proof
                </Badge>
              </DocumentLink>
            )}
            {tenant.bondTransferFileName && tenant.bondTransferFileData && (
              <DocumentLink fileName={tenant.bondTransferFileName} fileData={tenant.bondTransferFileData}>
                <Badge variant="outline" className="gap-1">
                  <FileText className="h-3 w-3" /> Bond Transfer
                </Badge>
              </DocumentLink>
            )}
            {latestRentChange && (
              <span className="text-xs text-muted-foreground">
                Previously {fmtCurrency(latestRentChange.oldRent)}/{tenant.rentFrequency} (
                {latestRentChange.newRent > latestRentChange.oldRent ? "increased" : "decreased"}{" "}
                {latestRentChange.changeDate})
              </span>
            )}
          </div>
        )}

        {isExpiredFixedTerm && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>Fixed-term lease ended {tenant.leaseExpiry}.</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => {
                if (
                  confirm(
                    `Continue ${tenant.name} on a periodic (rolling) tenancy at the same rent? The fixed term will be archived to lease history — you can still renew into a new fixed term later.`,
                  )
                ) {
                  convertToPeriodic(tenant.id);
                  toast.success("Converted to periodic tenancy. Fixed-term lease archived to history.");
                }
              }}
            >
              Convert to Periodic
            </Button>
            <span className="text-muted-foreground">or renew into a new fixed term below.</span>
          </div>
        )}

        <div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setShowActions((v) => !v)}
          >
            <SlidersHorizontal className="h-3 w-3" /> {showActions ? "Hide" : "Manage tenancy"}{" "}
            {showActions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          {showActions && (
            <div className="mt-2 space-y-3">
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Tenant record
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <TenantDialog propertyId={tenant.propertyId} tenant={tenant}>
                    <Button size="sm" variant="outline" className="gap-1">
                      <Pencil className="h-3.5 w-3.5" /> Edit tenant
                    </Button>
                  </TenantDialog>
                  <DeleteTenantDialog
                    tenant={tenant}
                    trigger={
                      <Button size="sm" variant="outline" className="gap-1 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" /> Delete tenant
                      </Button>
                    }
                  />
                  {hasLeaseDoc && (
                    <DocumentLink fileName={tenant.leaseDocumentFileName} fileData={tenant.leaseDocumentFileData}>
                      <Badge variant="outline" className="gap-1">
                        <FileText className="h-3 w-3" /> Lease PDF
                      </Badge>
                    </DocumentLink>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Tenancy actions
                </div>
                <div className="flex flex-wrap gap-2">
                  {property && (
                    <LeaseAgreementWizard property={property} tenant={tenant}>
                      <Button size="sm" variant="outline" className="gap-1">
                        <FileSignature className="h-3.5 w-3.5" /> Tenancy Agreement
                      </Button>
                    </LeaseAgreementWizard>
                  )}
                  <IncreaseRentDialog
                    tenant={tenant}
                    trigger={
                      <Button size="sm" variant="outline" className="gap-1">
                        <TrendingUp className="h-3.5 w-3.5" /> Change Rent
                      </Button>
                    }
                  />
                  <RenewLeaseDialog
                    tenant={tenant}
                    trigger={
                      <Button size="sm" variant="outline" className="gap-1">
                        <RefreshCw className="h-3.5 w-3.5" /> Renew Lease
                      </Button>
                    }
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Notices &amp; letters
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
              </div>

              {(history.length > 0 || rentChanges.length > 0) && (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Lease &amp; rent history
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setShowHist((v) => !v)}
                  >
                    <History className="h-3 w-3" /> {showHist ? "Hide" : "Show"} history (
                    {history.length + rentChanges.length})
                  </Button>
                  {showHist && (
                    <div className="mt-2 space-y-1 rounded bg-muted/50 p-2 text-xs">
                      {history.map((h) => (
                        <LeaseHistoryRow key={h.id} entry={h} />
                      ))}
                      {rentChanges.map((r) => (
                        <RentChangeRow key={r.id} entry={r} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
  agent_statement: "Agent statement",
};

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

function LedgerRowsTable({
  rows,
  onDelete,
  onToggleInvoicePaid,
}: {
  rows: LedgerRow[];
  onDelete: (row: LedgerRow) => void;
  onToggleInvoicePaid: (row: LedgerRow) => void;
}) {
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
                <div className="flex justify-end gap-1">
                  {r.invoiceId && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onToggleInvoicePaid(r)}>
                      Mark {r.invoiceStatus === "Paid" ? "Unpaid" : "Paid"}
                    </Button>
                  )}
                  {r.canDelete && (r.entryId || r.invoiceId) && (
                    <Button size="icon" variant="ghost" onClick={() => onDelete(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
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
  onToggleInvoicePaid,
}: {
  label: string;
  rows: LedgerRow[];
  onDelete: (row: LedgerRow) => void;
  onToggleInvoicePaid: (row: LedgerRow) => void;
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
        <LedgerRowsTable rows={rows} onDelete={onDelete} onToggleInvoicePaid={onToggleInvoicePaid} />
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
  const { state, addLedger, deleteLedger, deleteInvoice, updateInvoice } = useStore();
  const { rows, total, outstandingRent, outstandingInvoices } = buildTenantLedger(
    tenant,
    state.ledger,
    state.invoices,
    state.rentChanges,
  );
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [fy, setFy] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy">("month");

  const nextDue = addDays(tenant.paidUpToDate, 1);
  const propertyAddress = tenant.unitAddress || state.properties.find((p) => p.id === tenant.propertyId)?.address || "";
  const paidUpTo = paidUpToDetails(tenant, state.ledger, state.rentChanges);

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

  /** Emails a short "rent received" confirmation — the just-entered payment amount/date if the
   * landlord has typed one in, otherwise the most recent actual payment on this tenant's ledger.
   * Always states the authoritative, store-recalculated paidUpToDate rather than anything
   * computed locally, so it can never say something the ledger itself doesn't back up. */
  const emailRentReceived = () => {
    if (!tenant.email) return toast.error("This tenant has no email on file");
    const typedAmount = parseFloat(amount);
    const lastPayment = rows.filter((r) => r.credit > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const receivedAmount = typedAmount > 0 ? typedAmount : lastPayment?.credit;
    const receivedDate = typedAmount > 0 ? paymentDate : lastPayment?.date;
    if (!receivedAmount) return toast.error("No rent payment to reference — enter an amount or post a payment first");
    const subject = `Rent received — ${propertyAddress || "your rental"}`;
    const body = `Hi ${tenant.name},\n\nWe've received your rent payment of ${fmtCurrency(receivedAmount)}${receivedDate ? ` on ${receivedDate}` : ""}.\n\nYou are now paid up to ${tenant.paidUpToDate}.\n\nThanks`;
    openGmailCompose(tenant.email, subject, body);
  };

  const removeRow = (row: LedgerRow) => {
    if (row.invoiceId) {
      deleteInvoice(row.invoiceId);
      toast.success("Invoice removed");
      return;
    }
    if (row.entryId) {
      deleteLedger(row.entryId);
      toast.success("Ledger entry reversed — paid-up date recalculated");
    }
  };

  const toggleInvoicePaid = (row: LedgerRow) => {
    if (!row.invoiceId) return;
    updateInvoice(row.invoiceId, { status: row.invoiceStatus === "Paid" ? "Unpaid" : "Paid" });
    toast.success(row.invoiceStatus === "Paid" ? "Marked unpaid" : "Marked paid");
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
          <AdjustmentDialog tenant={tenant} />
          <Button variant="outline" className="gap-1" onClick={emailRentReceived} disabled={!tenant.email}>
            <Mail className="h-4 w-4" /> Email Tenant
          </Button>
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
          <LedgerRowsTable rows={filteredRows} onDelete={removeRow} onToggleInvoicePaid={toggleInvoicePaid} />
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
                onDelete={removeRow}
                onToggleInvoicePaid={toggleInvoicePaid}
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

  const downloadLedgerCsv = () => {
    const rowsData = rows.map((r) => [
      r.date,
      r.description,
      r.debit,
      r.credit,
      r.balance,
      r.source ? SOURCE_LABELS[r.source] ?? r.source : "",
    ]);
    downloadCsv(`ledger-${tenant.name.replace(/\s+/g, "-").toLowerCase()}-${todayISO()}.csv`, header, rowsData);
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
      <Button size="sm" variant="outline" className="gap-1" onClick={downloadLedgerCsv}>
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

interface BankStatementTransaction {
  date: string;
  description: string;
  amount: number;
  direction: "credit" | "debit";
}

function BankFeedDialog() {
  const { state, addLedger } = useStore();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<{ tenant: Tenant; amount: number; line: string }[]>([]);
  const [confirming, setConfirming] = useState<{ tenant: Tenant; amount: number } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const matchTenant = (line: string): Tenant | undefined => {
    const lower = line.toLowerCase();
    return state.tenants.find((t) => {
      const ref = (t.bankReference ?? "").toLowerCase();
      if (ref && lower.includes(ref)) return true;
      const parts = t.name.toLowerCase().split(/\s+/);
      return parts.some((p) => p.length > 2 && lower.includes(p));
    });
  };

  const parse = () => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const found: { tenant: Tenant; amount: number; line: string }[] = [];
    for (const line of lines) {
      const moneyMatch = line.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
      if (!moneyMatch) continue;
      const amount = parseFloat(moneyMatch[1]);
      if (!amount) continue;
      const tenant = matchTenant(line);
      if (tenant) found.push({ tenant, amount, line });
    }
    if (found.length === 0) toast.error("No matches found");
    setMatches(found);
  };

  const extractFromDocument = async (f: File) => {
    if (f.size > MAX_AI_UPLOAD_BYTES) {
      return toast.error(
        `This file is ${formatFileSize(f.size)} — the AI reader can only handle files up to ${formatFileSize(MAX_AI_UPLOAD_BYTES)}. Try a lower-resolution scan, or split it into smaller files.`,
      );
    }
    setExtracting(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Couldn't read file"));
        reader.readAsDataURL(f);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        transactions?: BankStatementTransaction[];
        error?: string;
      }>("extract-bank-statement", {
        body: { fileBase64: base64, fileName: f.name, mimeType: f.type || "application/pdf" },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || "Couldn't read this statement");
        return;
      }
      const credits = (data.transactions ?? []).filter((t) => t.direction === "credit");
      const found: { tenant: Tenant; amount: number; line: string }[] = [];
      for (const t of credits) {
        const line = `${t.date} ${t.description}`;
        const tenant = matchTenant(line);
        if (tenant) found.push({ tenant, amount: t.amount, line });
      }
      if (found.length === 0) {
        toast.error(`Read ${credits.length} deposit(s) but couldn't match any to a tenant`);
      } else {
        toast.success(`Matched ${found.length} of ${credits.length} deposit(s)`);
      }
      setMatches(found);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't process this statement");
    } finally {
      setExtracting(false);
    }
  };

  const handleFile = async (f: File) => {
    if (f.type === "application/pdf" || f.type.startsWith("image/")) {
      await extractFromDocument(f);
      return;
    }
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
          <Label className="text-xs">Paste bank feed lines, or upload a CSV, PDF or photo of the statement</Label>
          <Textarea
            placeholder="e.g. 2026-07-01 REF-SK-2026 Sarah Kim $720.00"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[120px] font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept=".csv,text/csv,.txt,application/pdf,image/*"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="max-w-xs"
              disabled={extracting}
            />
            <Button onClick={parse} disabled={extracting}>
              Parse
            </Button>
            {extracting && <span className="text-xs text-muted-foreground">Reading statement…</span>}
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

