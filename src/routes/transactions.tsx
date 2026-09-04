import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, Stat } from "@/components/Field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Pencil, Receipt, Search, SlidersHorizontal, Trash2, TriangleAlert, FileText, PanelRightClose, PanelRightOpen } from "lucide-react";
import { fmtCurrency, ausFinancialYear, fyRange, todayISO, categoryGroupOf, taxTreatmentLabel, buildFyOptions, fmtModified, ledgerTypeToIncomeCategory } from "@/lib/calculations";
import { downloadCsv } from "@/lib/csv";
import { bucketBy } from "@/lib/group";
import { usePersistedToggle, usePersistedState } from "@/lib/hooks";
import { toast } from "sonner";
import type { AssetType, CategoryGroup, RentLedgerProposalPayload } from "@/lib/types";
import { latestAgreementFor } from "@/lib/providerAgreements";
import { matchProviderByName } from "@/lib/providerMatch";
import { NeedsReviewBanner } from "@/components/NeedsReviewBanner";
import { DocumentLink } from "@/components/DocumentLink";
import { SortableTh, toggleSort, type SortState } from "@/components/SortableTh";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { BillDocumentViewer } from "@/components/BillDocumentViewer";
import { FeeCheckRow } from "@/components/PropertyShared";
import { verifyAgentFees, reconcileFlatFees, hasFeeTerms, collectAgentFeeLines, isAgentFeeExpense, type FeeCheckResult } from "@/lib/feeVerification";
import jsPDF from "jspdf";

function pdfSafe(s: string): string {
  return s.replace(/−/g, "-").replace(/ /g, " ");
}

export const Route = createFileRoute("/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions — Landlord OS" },
      { name: "description", content: "Every income and expense line item across the portfolio, in one ledger." },
    ],
  }),
  component: TransactionsPage,
});

function TransactionsPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground">Every income and expense line item across the portfolio.</p>
      </div>

      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="eofy">EOFY Report</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger" className="mt-4">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="eofy" className="mt-4">
          <EofyReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface TxRow {
  id: string;
  date: string;
  description: string;
  category: string;
  propertyId?: string;
  assetId?: string;
  amount: number; // positive = income, negative = outgoing
  /** GST component of `amount`, when known — expense rows only (rent has no GST). */
  gst?: number;
  source?: "Manual" | "Bank Feed" | "Email" | "Upload" | "Agent Statement";
  needsAttention?: boolean;
  /** Who this transaction was paid to (expenses, always populated) or received from (rent —
   * the collecting agent when paid via a rent statement, otherwise the tenant paying directly;
   * left blank if neither is known). */
  providerName?: string;
  /** Set only for expense-backed rows — used to open the edit dialog / delete this row when it's
   * an expense. */
  expenseId?: string;
  /** Set only for ledger-backed (rent payment) rows — same idea as expenseId, for the other row
   * type this table shows. Editing recomputes the tenant's paid-up-to date the same way deleting
   * already did. */
  ledgerEntryId?: string;
  /** The tenant this row is tied to — direct on ledger rows (whose payer is always a tenant) and
   * on expenses explicitly recharged to one; otherwise inferred as the sole current tenant at the
   * row's property (left unset if the property has none or more than one, rather than guessing). */
  tenantId?: string;
  tenantName?: string;
  /** Which dwelling (PropertyUnit) this row belongs to on a multi-unit property — direct on
   * ledger rows via the paying tenant's own unitId (rent is always dwelling-specific), and on
   * expense/bill rows only when the landlord explicitly filed it to one unit. Never inferred for
   * expenses: an untagged bill (council rates, land tax) stays whole-property/shared by design,
   * it is not split or guessed at just because the property happens to have units. */
  unitId?: string;
  /** Which ATO category group this expense falls under — undefined for ledger (rent) rows, which
   * have no tax treatment of their own. Drives the "For tax" breakdown and the EOFY deductible
   * total; falls back to the legacy coarse taxCategory for expenses saved before the grouped
   * taxonomy existed and never got a specific category. */
  taxGroup?: CategoryGroup;
  /** The statement/letter this row was extracted from, when it's a multi-line document rather
   * than a bill of its own — ledger rows paid via an agent statement (LedgerEntry.sourceFileName)
   * and expenses read off one (Expense.sourceFileName: an agent statement deduction, a bank/loan
   * statement line, a PEXA settlement adjustment). Shown in the Source column, distinct from
   * invoiceFileName below — a row can have one, the other, both, or neither. */
  sourceFileName?: string;
  sourceFileData?: string;
  /** The actual bill/receipt for this specific line, when one exists separately from the
   * statement above (Expense.invoiceFileName, or a later-forwarded one in additionalFiles).
   * Ledger (rent-received) rows never have one. Shown in its own Invoice column. */
  invoiceFileName?: string;
  invoiceFileData?: string;
  /** When this row was first added / last edited on screen — shown in the Last Modified column,
   * falling back to createdAt when a row has never been edited since it was added. */
  createdAt?: string;
  updatedAt?: string;
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

type TxSortField = "date" | "description" | "provider" | "property" | "tenant" | "category" | "taxTreatment" | "source" | "amount" | "modified";

type TxColumnKey = "date" | "provider" | "property" | "category" | "description" | "amount" | "source" | "invoice" | "tenant" | "taxTreatment" | "modified";

const TX_COLUMN_ORDER_KEY = "txColumnOrder";
const DEFAULT_TX_COLUMN_ORDER: TxColumnKey[] = [
  "date",
  "provider",
  "property",
  "category",
  "description",
  "amount",
  "source",
  "invoice",
  "tenant",
  "taxTreatment",
  "modified",
];

/** Drops any key from a stored order that this app version no longer has, and appends (in default
 * position) any current key the stored order predates — so an older saved preference never hides a
 * newly-added column or crashes on one that's since been removed. */
function reconcileColumnOrder(stored: TxColumnKey[]): TxColumnKey[] {
  const known = stored.filter((k) => DEFAULT_TX_COLUMN_ORDER.includes(k));
  const missing = DEFAULT_TX_COLUMN_ORDER.filter((k) => !known.includes(k));
  return [...known, ...missing];
}

function txSortValue(r: TxRow, field: TxSortField, propertyLabel: string): string | number {
  switch (field) {
    case "date":
      return r.date;
    case "description":
      return r.description;
    case "provider":
      return r.providerName ?? "";
    case "property":
      return propertyLabel;
    case "tenant":
      return r.tenantName ?? "";
    case "category":
      return r.category;
    case "taxTreatment":
      return taxTreatmentLabel(r.category);
    case "source":
      return r.source ?? "";
    case "amount":
      return r.amount;
    case "modified":
      return r.updatedAt ?? r.createdAt ?? "";
  }
}

export function LedgerTab({
  propertyId: lockedPropertyId,
  propertyIds: scopedPropertyIds,
}: { propertyId?: string; propertyIds?: string[] } = {}) {
  const { state } = useStore();
  const [fy, setFy] = useState("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy" | "provider" | "category">("none");
  const [propertyId, setPropertyId] = useState(lockedPropertyId ?? "__all__");
  const scopedProperties = scopedPropertyIds
    ? state.properties.filter((p) => scopedPropertyIds.includes(p.id))
    : state.properties;
  const [assetType, setAssetType] = useState<"__all__" | AssetType>("__all__");
  const [tenantId, setTenantId] = useState("__all__");
  const [unitId, setUnitId] = useState("__all__");
  const [providerFilterId, setProviderFilterId] = useState("__all__");
  const [query, setQuery] = useState("");
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState({ income: false, expense: false });
  const [sourceFilter, setSourceFilter] = useState({ manual: false, bankFeed: false, email: false, upload: false, agentStatement: false });
  const [sort, setSort] = useState<SortState<TxSortField> | null>(null);
  // Hidden by default so the table gets the full width — a landlord scanning transactions cares
  // about the rows, not the summary cards; the toggle remembers whoever last showed/hid it.
  const [showSummary, toggleSummary] = usePersistedToggle("txSummaryVisible");
  const { start, end } = fy === "all" ? { start: "", end: "" } : fyRange(fy);
  const fyLabel = fy === "all" ? "All time" : `FY ${fy}`;

  /** Sole current tenant at a property, if there's exactly one — used to attribute a row with no
   * direct tenant link (a general property expense) without guessing across dual-key properties. */
  const soleTenantAt = (propId?: string) => {
    if (!propId) return undefined;
    const at = state.tenants.filter((t) => t.propertyId === propId);
    return at.length === 1 ? at[0] : undefined;
  };

  // The dwelling filter only makes sense once viewing exactly one property — either this table is
  // locked to one (embedded on a property's own page) or the landlord has picked one from the
  // portfolio-wide Property filter — and only when that property actually has units on file.
  const singlePropertyId = lockedPropertyId ?? (propertyId !== "__all__" ? propertyId : "");
  const propertyUnitsForFilter = singlePropertyId ? state.properties.find((p) => p.id === singlePropertyId)?.units ?? [] : [];
  // Clears a stale selection when the property in scope changes (or the dwelling filter is no
  // longer applicable) rather than silently leaving an invisible filter narrowing the list.
  useEffect(() => {
    setUnitId("__all__");
  }, [singlePropertyId]);

  const fys = useMemo(() => buildFyOptions(), []);

  // Every bill that's ever marked Paid is guaranteed a paired Expense (markBillPaid creates one
  // the first time, the email-intake path pairs one at creation) — so state.expenses alone already
  // covers paid bills; adding state.bills here too would double-count them.
  /** Rent collected via an uploaded agent statement shows the agent as the provider (that's who
   * actually handled the money); rent recorded any other way is assumed paid directly by the
   * tenant. Left blank rather than guessing when neither is on file. */
  const agentNameFor = (propertyId?: string) => {
    if (!propertyId) return undefined;
    const taggedIds = new Set(state.providerProperties.filter((pp) => pp.propertyId === propertyId).map((pp) => pp.providerId));
    return state.providers.find((p) => taggedIds.has(p.id) && p.role === "Agent")?.name;
  };

  const allRows: TxRow[] = [
    ...state.ledger
      .filter((e) => e.credit > 0)
      .map((e) => {
        const tenant = state.tenants.find((t) => t.id === e.tenantId);
        return {
          id: `ledg_${e.id}`,
          ledgerEntryId: e.id,
          date: e.date,
          description: e.description || e.type,
          category: ledgerTypeToIncomeCategory(e.type),
          propertyId: tenant?.propertyId,
          amount: e.credit,
          source:
            e.source === "agent_statement"
              ? ("Agent Statement" as const)
              : e.source === "bank_feed"
                ? ("Bank Feed" as const)
                : ("Manual" as const),
          providerName: e.source === "agent_statement" ? agentNameFor(tenant?.propertyId) : tenant?.name,
          tenantId: e.tenantId,
          tenantName: tenant?.name,
          unitId: tenant?.unitId,
          sourceFileName: e.sourceFileName ?? undefined,
          sourceFileData: e.sourceFileData ?? undefined,
          createdAt: e.created_at,
          updatedAt: e.updatedAt,
        };
      }),
    ...state.expenses.map((e) => {
      const tenant = e.tenantId ? state.tenants.find((t) => t.id === e.tenantId) : soleTenantAt(e.propertyId);
      return {
        id: `exp_${e.id}`,
        date: e.date,
        description: e.itemName,
        // Never fall back to e.taxCategory here — "Immediate Deduction"/"Capital Works" aren't
        // real categories, and showing one as if it were just relabels the same bug this sentinel
        // replaced (see ledgerTypeToIncomeCategory above for the ledger-side equivalent fix).
        // "Uncategorized" stays visibly distinct from every real category so a gap is obvious
        // instead of silently plausible.
        category: e.category ?? "Uncategorized",
        propertyId: e.propertyId,
        assetId: e.assetId,
        amount: e.direction === "Income" ? e.cost : -e.cost,
        gst: e.gst,
        source:
          e.source === "agent_statement"
            ? ("Agent Statement" as const)
            : e.source === "email_auto"
              ? ("Email" as const)
              : e.source === "upload"
                ? ("Upload" as const)
                : ("Manual" as const),
        // The Provider directory's own name wins over this row's own raw extracted providerName
        // when it's linked to one — two bills for the same real vendor can extract slightly
        // different text ("Sydney Water" vs "Sydney Water Corporation"), and once providerId ties
        // them to the one directory record, Transactions should read as one consistent name
        // rather than whatever this particular document happened to print.
        providerName: (e.providerId && state.providers.find((p) => p.id === e.providerId)?.name) || e.providerName,
        needsAttention: e.status === "needs_review",
        expenseId: e.id,
        tenantId: tenant?.id,
        tenantName: tenant?.name,
        unitId: e.unitId,
        taxGroup: categoryGroupOf(e.category) ?? (e.taxCategory === "Immediate Deduction" ? "Running Expenses" : "Cost Base (Capital)"),
        sourceFileName: e.sourceFileName ?? undefined,
        sourceFileData: e.sourceFileData ?? undefined,
        invoiceFileName: e.invoiceFileName ?? e.additionalFiles?.[0]?.fileName ?? undefined,
        invoiceFileData: e.invoiceFileData ?? e.additionalFiles?.[0]?.fileData ?? undefined,
        createdAt: e.created_at,
        updatedAt: e.updatedAt,
      };
    }),
  ];

  const assetTypeOf = (r: TxRow) => state.assets.find((a) => a.id === r.assetId)?.assetType;
  const propertyLabelOf = (r: TxRow) => {
    const prop = state.properties.find((p) => p.id === r.propertyId);
    return prop?.alias || prop?.address || state.assets.find((a) => a.id === r.assetId)?.name || "";
  };
  const anyTypeFilter = typeFilter.income || typeFilter.expense;
  const anySourceFilter = sourceFilter.manual || sourceFilter.bankFeed || sourceFilter.email || sourceFilter.upload || sourceFilter.agentStatement;
  // Fuzzy word-boundary match against the selected provider's own name (same logic
  // findOrCreateProvider uses) rather than an exact string/FK match — most rows only ever carry
  // free-text providerName, not the provider's own id, and a legal-suffix/trading-name variant
  // (e.g. "Sydney Water" vs "Sydney Water Corporation") shouldn't make a row invisible here.
  const selectedProviderForFilter = providerFilterId !== "__all__" ? state.providers.find((p) => p.id === providerFilterId) : undefined;

  const filtered = allRows
    .filter((r) => fy === "all" || (r.date >= start && r.date <= end))
    .filter((r) => !scopedPropertyIds || (!!r.propertyId && scopedPropertyIds.includes(r.propertyId)))
    .filter((r) => propertyId === "__all__" || r.propertyId === propertyId)
    .filter((r) => assetType === "__all__" || assetTypeOf(r) === assetType)
    .filter((r) => tenantId === "__all__" || r.tenantId === tenantId)
    .filter((r) => unitId === "__all__" || r.unitId === unitId)
    .filter((r) => !selectedProviderForFilter || (!!r.providerName && !!matchProviderByName([selectedProviderForFilter], r.providerName)))
    .filter(
      (r) =>
        !query ||
        `${r.description} ${r.category} ${r.tenantName ?? ""} ${r.providerName ?? ""}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter((r) => !needsAttentionOnly || r.needsAttention)
    .filter((r) => !anyTypeFilter || (typeFilter.income && r.amount > 0) || (typeFilter.expense && r.amount < 0))
    .filter(
      (r) =>
        !anySourceFilter ||
        (sourceFilter.manual && r.source === "Manual") ||
        (sourceFilter.bankFeed && r.source === "Bank Feed") ||
        (sourceFilter.email && r.source === "Email") ||
        (sourceFilter.upload && r.source === "Upload") ||
        (sourceFilter.agentStatement && r.source === "Agent Statement"),
    )
    .sort((a, b) => {
      if (!sort) return a.date < b.date ? 1 : -1;
      const av = txSortValue(a, sort.field, propertyLabelOf(a));
      const bv = txSortValue(b, sort.field, propertyLabelOf(b));
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });

  const totalIncome = filtered.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalExpenses = filtered.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const totalGst = filtered.reduce((s, r) => s + (r.gst ?? 0), 0);
  const byCategory = filtered
    .filter((r) => r.amount < 0)
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + Math.abs(r.amount);
      return acc;
    }, {});
  const byTaxGroup = filtered
    .filter((r) => r.amount < 0 && r.taxGroup)
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.taxGroup!] = (acc[r.taxGroup!] ?? 0) + Math.abs(r.amount);
      return acc;
    }, {});
  const deductibleNow = byTaxGroup["Running Expenses"] ?? 0;

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = bucketBy(filtered, (r) =>
      groupBy === "month"
        ? r.date.slice(0, 7)
        : groupBy === "fy"
          ? ausFinancialYear(r.date)
          : groupBy === "provider"
            ? r.providerName || "No provider"
            : r.category,
    );
    // Date-keyed groups (month/FY) read newest-first, matching the flat list's own sort order;
    // provider/category groups have no inherent chronology, so those read alphabetically instead.
    const dateKeyed = groupBy === "month" || groupBy === "fy";
    return [...map.entries()].sort((a, b) => (dateKeyed ? (a[0] < b[0] ? 1 : -1) : a[0].localeCompare(b[0])));
  }, [filtered, groupBy]);

  const exportCsv = () => {
    const header = ["Date", "Description", "Provider", "Property", "Tenant", "Category", "Tax Treatment", "Source", "Source File", "Invoice File", "Amount", "GST"];
    const rows = filtered.map((r) => {
      const prop = state.properties.find((p) => p.id === r.propertyId);
      const asset = state.assets.find((a) => a.id === r.assetId);
      return [
        r.date,
        r.description,
        r.providerName ?? "",
        prop?.alias || prop?.address || asset?.name || "",
        r.tenantName ?? "",
        r.category,
        taxTreatmentLabel(r.category),
        r.source ?? "",
        r.sourceFileName ?? "",
        r.invoiceFileName ?? "",
        r.amount,
        r.gst ?? "",
      ];
    });
    downloadCsv(`transactions-${fy}.csv`, header, rows);
    toast.success("Transactions CSV downloaded");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search transactions…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-[200px] pl-7" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {fys.map((y) => (
                <SelectItem key={y} value={y}>
                  FY {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No grouping</SelectItem>
              <SelectItem value="month">By month</SelectItem>
              <SelectItem value="fy">By financial year</SelectItem>
              <SelectItem value="provider">By provider</SelectItem>
              <SelectItem value="category">By category</SelectItem>
            </SelectContent>
          </Select>
          {!lockedPropertyId && (
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All properties</SelectItem>
                {scopedProperties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.alias || p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!lockedPropertyId && !scopedPropertyIds && (
            <Select value={assetType} onValueChange={(v) => setAssetType(v as typeof assetType)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All asset types</SelectItem>
                <SelectItem value="Property">Property</SelectItem>
                <SelectItem value="Gold">Gold</SelectItem>
                <SelectItem value="ETF">ETF</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All tenants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All tenants</SelectItem>
              {state.tenants
                .filter((t) => propertyId !== "__all__" ? t.propertyId === propertyId : !scopedPropertyIds || scopedPropertyIds.includes(t.propertyId))
                .map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {propertyUnitsForFilter.length > 0 && (
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All dwellings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All dwellings</SelectItem>
                {propertyUnitsForFilter.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={providerFilterId} onValueChange={setProviderFilterId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All providers</SelectItem>
              {[...state.providers]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuCheckboxItem checked={needsAttentionOnly} onCheckedChange={setNeedsAttentionOnly}>
                Needs attention
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Type</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={typeFilter.income} onCheckedChange={(v) => setTypeFilter((f) => ({ ...f, income: v === true }))}>
                Income
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={typeFilter.expense} onCheckedChange={(v) => setTypeFilter((f) => ({ ...f, expense: v === true }))}>
                Expense
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Source</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={sourceFilter.manual} onCheckedChange={(v) => setSourceFilter((f) => ({ ...f, manual: v === true }))}>
                Manual
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={sourceFilter.bankFeed} onCheckedChange={(v) => setSourceFilter((f) => ({ ...f, bankFeed: v === true }))}>
                Bank Feed
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={sourceFilter.email} onCheckedChange={(v) => setSourceFilter((f) => ({ ...f, email: v === true }))}>
                Email
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={sourceFilter.upload} onCheckedChange={(v) => setSourceFilter((f) => ({ ...f, upload: v === true }))}>
                Upload
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sourceFilter.agentStatement}
                onCheckedChange={(v) => setSourceFilter((f) => ({ ...f, agentStatement: v === true }))}
              >
                Agent Statement
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" className="gap-1" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={toggleSummary}>
            {showSummary ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            {showSummary ? "Hide summary" : "Show summary"}
          </Button>
          <AddTransactionDialog propertyId={lockedPropertyId} />
        </div>
      </div>

      <NeedsReviewBanner />

      <div className={showSummary ? "grid gap-4 lg:grid-cols-3" : "grid gap-4"}>
        <div className={showSummary ? "lg:col-span-2" : ""}>
          <Card>
            {groupBy === "none" || !groups ? (
              <TxTable
                rows={filtered}
                lockedPropertyId={lockedPropertyId}
                sort={sort}
                onSort={(f) => setSort((s) => toggleSort(s, f))}
              />
            ) : (
              <div className="space-y-2 p-2">
                {groups.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground">No transactions match these filters.</div>
                )}
                {groups.map(([key, groupRows]) => (
                  <TxGroupSection
                    key={key}
                    label={groupBy === "month" ? formatMonthLabel(key) : groupBy === "fy" ? `FY ${key}` : key}
                    rows={groupRows}
                    lockedPropertyId={lockedPropertyId}
                    sort={sort}
                    onSort={(f) => setSort((s) => toggleSort(s, f))}
                  />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                {filtered.length} of {(fy === "all" ? allRows : allRows.filter((r) => r.date >= start && r.date <= end)).length} transactions
              </span>
              <span className="flex flex-wrap items-center gap-x-3">
                <span>
                  Income <span className="font-medium text-emerald-600">{fmtCurrency(totalIncome)}</span>
                </span>
                <span>
                  Expenses <span className="font-medium text-destructive">{fmtCurrency(Math.abs(totalExpenses))}</span>
                </span>
                <span>
                  GST <span className="font-medium">{fmtCurrency(totalGst)}</span>
                </span>
                <span>
                  Net{" "}
                  <span className={"font-semibold " + (totalIncome + totalExpenses < 0 ? "text-destructive" : "text-emerald-600")}>
                    {totalIncome + totalExpenses < 0 ? "−" : "+"}
                    {fmtCurrency(Math.abs(totalIncome + totalExpenses))}
                  </span>
                </span>
              </span>
            </div>
          </Card>
        </div>

        {showSummary && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary — {fyLabel}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Income</span>
                <span className="font-medium text-emerald-600">{fmtCurrency(totalIncome)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expenses</span>
                <span className="font-medium text-destructive">{fmtCurrency(Math.abs(totalExpenses))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST</span>
                <span className="font-medium">{fmtCurrency(totalGst)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t pt-2">
                <span className="font-medium">Net</span>
                <span className={"font-semibold " + (totalIncome + totalExpenses < 0 ? "text-destructive" : "text-emerald-600")}>
                  {totalIncome + totalExpenses < 0 ? "−" : "+"}
                  {fmtCurrency(Math.abs(totalIncome + totalExpenses))}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where money goes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.keys(byCategory).length === 0 && <div className="text-xs text-muted-foreground">No expenses in this range.</div>}
              {Object.entries(byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amount]) => (
                  <div key={cat} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{cat}</span>
                    <span className="font-medium">{fmtCurrency(amount)}</span>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">For tax</CardTitle>
              <div className="text-xs text-muted-foreground">Only Running Expenses reduce this year's taxable income</div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.keys(byTaxGroup).length === 0 && <div className="text-xs text-muted-foreground">No expenses in this range.</div>}
              {Object.entries(byTaxGroup).map(([group, amount]) => (
                <div key={group} className="flex items-center justify-between">
                  <span className={group === "Running Expenses" ? "font-medium" : "text-muted-foreground"}>{group}</span>
                  <span className="font-medium">{fmtCurrency(amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-2">
                <span className="font-medium">Deductible now</span>
                <span className="font-semibold">{fmtCurrency(deductibleNow)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
        )}
      </div>
    </div>
  );
}

/** Edits a rent-payment ledger row's date/amount/description straight from the Transactions
 * table — previously only deletable there, or from the tenant's own Ledger tab, with no edit at
 * all in either place. Updating recomputes the tenant's paid-up-to date the same way a delete
 * already did (see updateLedger in store.tsx). Shows the same source-document pane as editing an
 * expense — a rent line posted via an agent statement has one (LedgerEntry.sourceFileName), so
 * this income-side edit isn't a stripped-down experience next to the expense one. */
function EditLedgerRowDialog({ ledgerEntryId, trigger }: { ledgerEntryId: string; trigger: React.ReactNode }) {
  const { state, updateLedger } = useStore();
  const entry = state.ledger.find((e) => e.id === ledgerEntryId);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(entry?.date ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.credit) : "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [sourceDoc, setSourceDoc] = useState<{ fileName?: string; fileData?: string } | null>(null);
  const [sourceDocRemoved, setSourceDocRemoved] = useState(false);
  const [docExpanded, setDocExpanded] = useState(false);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o && entry) {
      setDate(entry.date);
      setAmount(String(entry.credit));
      setDescription(entry.description);
      setSourceDoc(entry.sourceFileName ? { fileName: entry.sourceFileName, fileData: entry.sourceFileData ?? undefined } : null);
      setSourceDocRemoved(false);
    }
    if (!o) setDocExpanded(false);
  };

  const save = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return toast.error("Enter a valid amount");
    if (!date) return toast.error("Date is required");
    updateLedger(ledgerEntryId, {
      date,
      credit: val,
      description,
      ...(sourceDocRemoved ? { sourceFileName: null, sourceFileData: null } : {}),
    });
    toast.success("Rent payment updated");
    setOpen(false);
  };

  if (!entry) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={
          docExpanded
            ? "flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-y-auto"
            : "max-w-2xl"
        }
      >
        <DialogHeader>
          <DialogTitle>Edit rent payment</DialogTitle>
        </DialogHeader>
        <div className={"grid gap-4 text-sm " + (docExpanded ? "flex-1 overflow-hidden sm:grid-cols-[minmax(0,1fr)_320px]" : "sm:grid-cols-[240px_1fr]")}>
          <div className={docExpanded ? "overflow-y-auto pr-1" : ""}>
            <BillDocumentViewer
              fileName={sourceDoc?.fileName}
              fileData={sourceDoc?.fileData}
              expanded={docExpanded}
              onToggleExpand={() => setDocExpanded((v) => !v)}
              onRemove={
                sourceDoc
                  ? () => {
                      setSourceDoc(null);
                      setSourceDocRemoved(true);
                    }
                  : undefined
              }
              emptyLabel="No source statement — this payment was entered directly."
            />
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renders one column's cell content for a TxRow — kept as a single switch (rather than a column
 * registry with per-column components) since most cells need several row-derived locals
 * (propertyLabel, asset, ...) computed once per row above it. */
function txCell(key: TxColumnKey, r: TxRow, propertyLabel: string | undefined): React.ReactNode {
  switch (key) {
    case "date":
      return r.date;
    case "provider":
      return r.providerName ?? "—";
    case "property":
      return propertyLabel ?? "—";
    case "category":
      return r.category;
    case "description":
      return (
        <div className="flex items-center gap-1.5 font-medium">
          {r.needsAttention && <TriangleAlert className="h-3 w-3 shrink-0 text-amber-600" />}
          {r.description}
        </div>
      );
    case "amount":
      return (
        <span className={`font-medium ${r.amount < 0 ? "text-destructive" : "text-emerald-600"}`}>
          {r.amount < 0 ? "−" : "+"}
          {fmtCurrency(Math.abs(r.amount))}
        </span>
      );
    case "source":
      return r.sourceFileData ? (
        <DocumentLink fileName={r.sourceFileName} fileData={r.sourceFileData} className="inline-flex items-center gap-1 text-primary underline">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="max-w-[140px] truncate">{r.sourceFileName || "Document"}</span>
        </DocumentLink>
      ) : (
        <span className="text-muted-foreground">{r.source ?? "—"}</span>
      );
    case "invoice":
      return r.invoiceFileData ? (
        <DocumentLink fileName={r.invoiceFileName} fileData={r.invoiceFileData} className="inline-flex items-center gap-1 text-primary underline">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="max-w-[140px] truncate">{r.invoiceFileName || "Document"}</span>
        </DocumentLink>
      ) : (
        <span className="text-muted-foreground">— ({r.ledgerEntryId ? "No file needed" : "No invoice"})</span>
      );
    case "tenant":
      return r.tenantName ?? "—";
    case "taxTreatment":
      return taxTreatmentLabel(r.category);
    case "modified":
      return r.updatedAt ? (
        <span title={`Added ${fmtModified(r.createdAt) ?? "unknown"}`}>Edited {fmtModified(r.updatedAt)}</span>
      ) : (
        <span className="text-muted-foreground">{fmtModified(r.createdAt) ?? "—"}</span>
      );
  }
}

const TX_COLUMN_LABELS: Record<TxColumnKey, string> = {
  date: "Date",
  provider: "Provider",
  property: "Property",
  category: "Category",
  description: "Description",
  amount: "Amount",
  source: "Source",
  invoice: "Invoice / Attachment",
  tenant: "Tenant",
  taxTreatment: "Tax Treatment",
  modified: "Last Modified",
};
/** "invoice" has no sortable value of its own (a file link isn't a sort key) — every other column
 * maps 1:1 onto a TxSortField. */
const TX_COLUMN_SORT_FIELD: Partial<Record<TxColumnKey, TxSortField>> = {
  date: "date",
  provider: "provider",
  property: "property",
  category: "category",
  description: "description",
  amount: "amount",
  source: "source",
  tenant: "tenant",
  taxTreatment: "taxTreatment",
  modified: "modified",
};

function TxTable({
  rows,
  lockedPropertyId,
  sort,
  onSort,
}: {
  rows: TxRow[];
  lockedPropertyId?: string;
  sort?: SortState<TxSortField> | null;
  onSort?: (field: TxSortField) => void;
}) {
  const { state, deleteExpense, deleteLedger } = useStore();
  const [storedOrder, setStoredOrder] = usePersistedState<TxColumnKey[]>(TX_COLUMN_ORDER_KEY, DEFAULT_TX_COLUMN_ORDER);
  const columnOrder = reconcileColumnOrder(storedOrder);
  const [draggedKey, setDraggedKey] = useState<TxColumnKey | null>(null);
  const visibleColumns = columnOrder.filter((k) => k !== "property" || !lockedPropertyId);

  const reorder = (target: TxColumnKey) => {
    if (!draggedKey || draggedKey === target) return;
    setStoredOrder((order) => {
      const next = reconcileColumnOrder(order);
      const from = next.indexOf(draggedKey);
      const to = next.indexOf(target);
      next.splice(from, 1);
      next.splice(to, 0, draggedKey);
      return next;
    });
    setDraggedKey(null);
  };

  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <Receipt className="mx-auto mb-2 h-6 w-6" />
        No transactions in this period.
      </div>
    );
  }
  const noSort = () => {};
  return (
    // Bounded height (not just overflow-x-auto with no height cap) so both scrollbars sit right
    // at the edge of this table, visible without first scrolling to the bottom of a page that can
    // run to hundreds of rows — previously the horizontal scrollbar only appeared at the very
    // bottom of the whole (unbounded) table, effectively unreachable on a long list.
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-left text-xs text-muted-foreground">
            {visibleColumns.map((key) => {
              const sortField = TX_COLUMN_SORT_FIELD[key];
              const dragProps = {
                draggable: true,
                onDragStart: () => setDraggedKey(key),
                onDragOver: (e: React.DragEvent) => e.preventDefault(),
                onDrop: () => reorder(key),
                onDragEnd: () => setDraggedKey(null),
              };
              return sortField ? (
                <SortableTh
                  key={key}
                  field={sortField}
                  label={TX_COLUMN_LABELS[key]}
                  align={key === "amount" ? "right" : "left"}
                  sort={sort ?? null}
                  onSort={onSort ?? noSort}
                  className={`cursor-grab active:cursor-grabbing ${draggedKey === key ? "opacity-40" : ""}`}
                  {...dragProps}
                />
              ) : (
                <th
                  key={key}
                  className={`cursor-grab px-3 py-2 text-left text-xs font-medium text-muted-foreground active:cursor-grabbing ${draggedKey === key ? "opacity-40" : ""}`}
                  {...dragProps}
                >
                  {TX_COLUMN_LABELS[key]}
                </th>
              );
            })}
            <th className="w-16 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const prop = state.properties.find((p) => p.id === r.propertyId);
            const asset = state.assets.find((a) => a.id === r.assetId);
            const propertyLabel = prop?.alias || prop?.address || asset?.name;
            const expense = r.expenseId ? state.expenses.find((e) => e.id === r.expenseId) : undefined;
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                {visibleColumns.map((key) => (
                  <td
                    key={key}
                    className={`px-3 py-2 text-xs ${key === "amount" ? "text-right" : ""} ${
                      key === "date" || key === "modified" ? "whitespace-nowrap" : ""
                    } ${["provider", "property", "tenant", "category", "taxTreatment", "modified"].includes(key) ? "text-muted-foreground" : ""}`}
                  >
                    {txCell(key, r, propertyLabel)}
                  </td>
                ))}
                <td className="px-2 py-2">
                  {expense && (
                    <div className="flex items-center justify-end gap-0.5">
                      <AddTransactionDialog
                        expense={expense}
                        trigger={
                          <Button size="icon" variant="ghost" className="h-6 w-6">
                            <Pencil className="h-3 w-3" />
                          </Button>
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => {
                          if (confirm(`Delete "${expense.itemName}"?`)) {
                            deleteExpense(expense.id);
                            toast.success("Transaction removed");
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {r.ledgerEntryId && (
                    <div className="flex items-center justify-end gap-0.5">
                      <EditLedgerRowDialog
                        ledgerEntryId={r.ledgerEntryId}
                        trigger={
                          <Button size="icon" variant="ghost" className="h-6 w-6">
                            <Pencil className="h-3 w-3" />
                          </Button>
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => {
                          if (confirm(`Delete "${r.description}"?`)) {
                            deleteLedger(r.ledgerEntryId!);
                            toast.success("Rent payment removed");
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TxGroupSection({
  label,
  rows,
  lockedPropertyId,
  sort,
  onSort,
}: {
  label: string;
  rows: TxRow[];
  lockedPropertyId?: string;
  sort?: SortState<TxSortField> | null;
  onSort?: (field: TxSortField) => void;
}) {
  const income = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const expenses = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  return (
    <CollapsibleGroupSection
      label={label}
      summary={
        <>
          <span className="text-emerald-600">Income {fmtCurrency(income)}</span>
          <span className="text-destructive">Expenses {fmtCurrency(Math.abs(expenses))}</span>
        </>
      }
    >
      <TxTable rows={rows} lockedPropertyId={lockedPropertyId} sort={sort} onSort={onSort} />
    </CollapsibleGroupSection>
  );
}

function EofyReport() {
  const { state, addReportHistoryEntry } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [scope, setScope] = useState("all");
  const [fy, setFy] = useState(currentFY);
  const [report, setReport] = useState<null | {
    gross: number;
    byCategory: Record<string, number>;
    interest: number;
    total: number;
    net: number;
    scopeLabel: string;
    feeChecksByProperty: { propertyLabel: string; agentName: string; results: FeeCheckResult[] }[];
  }>(null);

  const scopeProperties = () => {
    if (scope === "all") return state.properties;
    if (scope.startsWith("entity:")) {
      const entityId = scope.slice("entity:".length);
      return state.properties.filter((p) => p.entityId === entityId);
    }
    const propertyId = scope.slice("property:".length);
    return state.properties.filter((p) => p.id === propertyId);
  };

  const scopeLabel = () => {
    if (scope === "all") return "All properties";
    if (scope.startsWith("entity:")) {
      const entityId = scope.slice("entity:".length);
      return state.entities.find((e) => e.id === entityId)?.name ?? "Entity";
    }
    const propertyId = scope.slice("property:".length);
    const p = state.properties.find((x) => x.id === propertyId);
    return p?.alias || p?.address || "Property";
  };

  const generate = () => {
    const properties = scopeProperties();
    if (properties.length === 0) return toast.error("No properties in this scope");
    const { start, end } = fyRange(fy);
    let gross = 0;
    let totalExp = 0;
    let interest = 0;
    const byCategory: Record<string, number> = {};
    const feeChecksByProperty: { propertyLabel: string; agentName: string; results: FeeCheckResult[] }[] = [];
    for (const prop of properties) {
      const tenantIds = state.tenants.filter((t) => t.propertyId === prop.id).map((t) => t.id);
      const rentCollected = state.ledger
        .filter((e) => tenantIds.includes(e.tenantId) && e.date >= start && e.date <= end && e.type === "Rent Payment")
        .reduce((s, e) => s + e.credit, 0);
      gross += rentCollected;
      const expenses = state.expenses.filter((e) => e.propertyId === prop.id && e.date >= start && e.date <= end);
      for (const e of expenses) {
        const group =
          categoryGroupOf(e.category) ?? (e.taxCategory === "Immediate Deduction" ? "Running Expenses" : "Cost Base (Capital)");
        byCategory[group] = (byCategory[group] ?? 0) + e.cost;
        // Only Running Expenses reduce this year's taxable income — Depreciation, Cost Base
        // (Capital) and Non-Deductible spending is real cash out but not a current-year deduction.
        if (group === "Running Expenses") totalExp += e.cost;
      }
      const loan = state.loans.find((l) => l.propertyId === prop.id);
      if (loan) interest += (loan.totalBalance * loan.interestRate) / 100;

      const agentProviderIds = new Set(
        state.providerProperties.filter((pp) => pp.propertyId === prop.id).map((pp) => pp.providerId),
      );
      const agent = state.providers.find((p) => agentProviderIds.has(p.id) && p.role === "Agent");
      const agreement = agent ? latestAgreementFor(state.providerAgreements, agent.id, prop.id) : undefined;
      if (agent && agreement && hasFeeTerms(agreement)) {
        // Only expenses actually tied to the agent — its dedicated fee category, or paid to the
        // agent by name — count toward fee verification; every other expense in the property's
        // full FY list (repairs, insurance, rates, etc.) has nothing to do with the agreement.
        const agentExpenses = expenses.filter((e) => isAgentFeeExpense(e, agent.name));
        const lines = collectAgentFeeLines(agentExpenses);
        // "Per Statement" admin-fee annualization needs how many rent statements actually came in
        // over the FY — every real statement gets uploaded/emailed in as a rent_ledger proposal.
        const statementCount = state.aiProposals.filter((p) => {
          if (p.propertyId !== prop.id || p.kind !== "rent_ledger" || p.status === "dismissed") return false;
          const date = (p.payload as RentLedgerProposalPayload).periodStart ?? p.documentDate ?? p.created_at?.slice(0, 10) ?? "";
          return date >= start && date <= end;
        }).length;
        // Management/Letting Fee are genuinely per-transaction, computed here over the whole FY in
        // one call (mathematically identical to summing per-period); Admin/Lease Renewal/
        // Inspection Fee are flat contracted amounts reconciled once for the FY instead — see
        // feeVerification.ts's doc comments for why mixing the two overstated the flat fees.
        // A letting fee contracted as "N weeks' rent" needs the actual tenant's weekly rent to
        // convert to a dollar figure — only resolvable when the property had exactly one tenant
        // over the FY, the same "unambiguous single tenant" resolution used elsewhere for this
        // (see singleAssignedTenant in PropertyShared.tsx's feeChecks, and PropertyFeeVerificationTab).
        const soleTenant = tenantIds.length === 1 ? state.tenants.find((t) => t.id === tenantIds[0]) : undefined;
        const results = [
          ...verifyAgentFees({
            agentName: agent.name,
            agreement,
            rentCollected,
            lines,
            tenantRent: soleTenant ? { amount: soleTenant.rentAmount, frequency: soleTenant.rentFrequency } : undefined,
            feeTypes: ["Management Fee", "Letting Fee"],
          }),
          ...reconcileFlatFees({ agentName: agent.name, agreement, lines, statementCount }),
        ];
        if (results.length > 0) {
          feeChecksByProperty.push({ propertyLabel: prop.alias || prop.address, agentName: agent.name, results });
        }
      }
    }
    const label = scopeLabel();
    setReport({ gross, byCategory, interest, total: totalExp, net: gross - totalExp - interest, scopeLabel: label, feeChecksByProperty });
    addReportHistoryEntry({ fy, scopeLabel: label, generatedAt: todayISO() });
  };

  const downloadPdf = () => {
    if (!report) return;
    const doc = new jsPDF();
    const marginX = 14;
    let y = 18;

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafe("EOFY Tax Summary"), marginX, y);
    y += 7;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(85);
    doc.text(pdfSafe(`${report.scopeLabel} - Financial Year ${fy} - Generated ${todayISO()}`), marginX, y);
    y += 10;

    const line = (label: string, value: string, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setTextColor(17);
      doc.setFontSize(10);
      doc.text(pdfSafe(label), marginX, y);
      doc.text(pdfSafe(value), marginX + 90, y);
      y += 7;
    };

    line("Gross rent collected", fmtCurrency(report.gross), true);
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.text("Expenses by ATO category group", marginX, y);
    y += 6;
    for (const [k, v] of Object.entries(report.byCategory)) {
      line(`  ${k}`, fmtCurrency(v));
    }
    line("Total deductible (Running Expenses)", fmtCurrency(report.total), true);
    y += 2;
    line("Estimated loan interest paid", fmtCurrency(report.interest));
    y += 2;
    line("Net taxable profit / loss", fmtCurrency(report.net), true);

    doc.save(`EOFY-${fy}-${report.scopeLabel.replace(/\s+/g, "-").toLowerCase().slice(0, 30)}.pdf`);
    toast.success("EOFY PDF downloaded");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">EOFY Statement Generator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Scope">
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All properties</SelectItem>
                  {state.entities.map((e) => (
                    <SelectItem key={e.id} value={`entity:${e.id}`}>
                      {e.name}
                    </SelectItem>
                  ))}
                  {state.properties.map((p) => (
                    <SelectItem key={p.id} value={`property:${p.id}`}>
                      {p.alias || p.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Financial year">
              <Select value={fy} onValueChange={setFy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 }).map((_, i) => {
                    const y = new Date().getFullYear() - 2 + i;
                    const v = `${y}-${y + 1}`;
                    return (
                      <SelectItem key={v} value={v}>
                        FY {v}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button onClick={generate}>Generate</Button>
            </div>
          </div>

          {report && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Scope</div>
                  <div className="font-medium">{report.scopeLabel}</div>
                </div>
                <Button size="sm" variant="outline" className="gap-1" onClick={downloadPdf}>
                  <Download className="h-4 w-4" /> Download PDF
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Stat className="bg-background" label="Gross rent collected" value={fmtCurrency(report.gross)} />
                <Stat className="bg-background" label="Total deductible (Running Expenses)" value={fmtCurrency(report.total)} />
                <Stat className="bg-background" label="Loan interest (est.)" value={fmtCurrency(report.interest)} />
                <Stat
                  className="bg-background"
                  label="Net taxable profit / loss"
                  value={fmtCurrency(report.net)}
                  strong
                  negative={report.net < 0}
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">Expenses by ATO category group</div>
                <div className="mb-1 text-xs text-muted-foreground">
                  Only Running Expenses is deducted above — Depreciation, Cost Base (Capital) and Non-Deductible are shown for reference.
                </div>
                {Object.entries(report.byCategory).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-t py-1">
                    <span>{k}</span>
                    <span>{fmtCurrency(v)}</span>
                  </div>
                ))}
                {Object.keys(report.byCategory).length === 0 && (
                  <div className="text-xs text-muted-foreground">No expenses in this period.</div>
                )}
              </div>
              {report.feeChecksByProperty.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium">Property manager fee verification</div>
                  <div className="space-y-3">
                    {report.feeChecksByProperty.map((f) => (
                      <div key={f.propertyLabel} className="space-y-1">
                        <div className="text-xs text-muted-foreground">
                          {f.propertyLabel} — {f.agentName}
                        </div>
                        {f.results.map((r) => (
                          <FeeCheckRow key={r.type} result={r} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {state.reportHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {state.reportHistory.map((r, i) => (
              <div key={i} className="flex justify-between border-t py-1 first:border-t-0">
                <span>
                  FY {r.fy} — {r.scopeLabel}
                </span>
                <span className="text-muted-foreground">{r.generatedAt}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
