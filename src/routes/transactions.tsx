import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Pencil, Receipt, Search, SlidersHorizontal, Trash2, TriangleAlert, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { fmtCurrency, ausFinancialYear, fyRange, todayISO, categoryGroupOf } from "@/lib/calculations";
import { downloadCsv } from "@/lib/csv";
import { toast } from "sonner";
import type { AssetType, CategoryGroup } from "@/lib/types";
import { NeedsReviewBanner } from "@/components/NeedsReviewBanner";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { FeeCheckRow } from "@/components/PropertyShared";
import { verifyAgentFees, hasFeeTerms, collectAgentFeeLines, type FeeCheckResult } from "@/lib/feeVerification";
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
  source?: "Manual" | "Email" | "Upload";
  needsAttention?: boolean;
  /** Set only for expense-backed rows — the only ones editable/deletable from this table.
   * Rent-payment ledger rows have their own edit/delete flow on the tenant's own ledger, which
   * also reverses the paid-up-to-date shift correctly; this table doesn't duplicate that. */
  expenseId?: string;
  /** The tenant this row is tied to — direct on ledger rows (whose payer is always a tenant) and
   * on expenses explicitly recharged to one; otherwise inferred as the sole current tenant at the
   * row's property (left unset if the property has none or more than one, rather than guessing). */
  tenantId?: string;
  tenantName?: string;
  /** Which ATO category group this expense falls under — undefined for ledger (rent) rows, which
   * have no tax treatment of their own. Drives the "For tax" breakdown and the EOFY deductible
   * total; falls back to the legacy coarse taxCategory for expenses saved before the grouped
   * taxonomy existed and never got a specific category. */
  taxGroup?: CategoryGroup;
  /** The source document this row was read off, when there is one — ledger rows from a rent
   * statement (LedgerEntry.sourceFileName/Data) and expense rows with an attached invoice/receipt
   * (Expense.invoiceFileName/Data). Lets the Source column link straight back to it. */
  sourceFileName?: string;
  sourceFileData?: string;
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

export function LedgerTab({ propertyId: lockedPropertyId }: { propertyId?: string } = {}) {
  const { state } = useStore();
  const [fy, setFy] = useState("all");
  const [groupBy, setGroupBy] = useState<"none" | "month" | "fy">("none");
  const [propertyId, setPropertyId] = useState(lockedPropertyId ?? "__all__");
  const [assetType, setAssetType] = useState<"__all__" | AssetType>("__all__");
  const [tenantId, setTenantId] = useState("__all__");
  const [query, setQuery] = useState("");
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState({ income: false, expense: false });
  const [sourceFilter, setSourceFilter] = useState({ manual: false, email: false, upload: false });
  const { start, end } = fy === "all" ? { start: "", end: "" } : fyRange(fy);
  const fyLabel = fy === "all" ? "All time" : `FY ${fy}`;

  /** Sole current tenant at a property, if there's exactly one — used to attribute a row with no
   * direct tenant link (a general property expense) without guessing across dual-key properties. */
  const soleTenantAt = (propId?: string) => {
    if (!propId) return undefined;
    const at = state.tenants.filter((t) => t.propertyId === propId);
    return at.length === 1 ? at[0] : undefined;
  };

  const fys = useMemo(() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(`${y}-${y + 1}`);
    return years;
  }, []);

  // Every bill that's ever marked Paid is guaranteed a paired Expense (markBillPaid creates one
  // the first time, the email-intake path pairs one at creation) — so state.expenses alone already
  // covers paid bills; adding state.bills here too would double-count them.
  const allRows: TxRow[] = [
    ...state.ledger
      .filter((e) => e.credit > 0)
      .map((e) => {
        const tenant = state.tenants.find((t) => t.id === e.tenantId);
        return {
          id: `ledg_${e.id}`,
          date: e.date,
          description: e.description || e.type,
          category: e.type,
          propertyId: tenant?.propertyId,
          amount: e.credit,
          source: e.source === "rent_statement" ? ("Upload" as const) : ("Manual" as const),
          tenantId: e.tenantId,
          tenantName: tenant?.name,
          sourceFileName: e.sourceFileName,
          sourceFileData: e.sourceFileData,
        };
      }),
    ...state.expenses.map((e) => {
      const tenant = e.tenantId ? state.tenants.find((t) => t.id === e.tenantId) : soleTenantAt(e.propertyId);
      return {
        id: `exp_${e.id}`,
        date: e.date,
        description: e.itemName,
        category: e.category ?? e.taxCategory,
        propertyId: e.propertyId,
        assetId: e.assetId,
        amount: e.direction === "Income" ? e.cost : -e.cost,
        source: e.source === "email_auto" ? ("Email" as const) : e.source === "upload" ? ("Upload" as const) : ("Manual" as const),
        needsAttention: e.status === "needs_review",
        expenseId: e.id,
        tenantId: tenant?.id,
        tenantName: tenant?.name,
        taxGroup: categoryGroupOf(e.category) ?? (e.taxCategory === "Immediate Deduction" ? "Running Expenses" : "Cost Base (Capital)"),
        sourceFileName: e.invoiceFileName,
        sourceFileData: e.invoiceFileData,
      };
    }),
  ];

  const assetTypeOf = (r: TxRow) => state.assets.find((a) => a.id === r.assetId)?.assetType;
  const anyTypeFilter = typeFilter.income || typeFilter.expense;
  const anySourceFilter = sourceFilter.manual || sourceFilter.email || sourceFilter.upload;

  const filtered = allRows
    .filter((r) => fy === "all" || (r.date >= start && r.date <= end))
    .filter((r) => propertyId === "__all__" || r.propertyId === propertyId)
    .filter((r) => assetType === "__all__" || assetTypeOf(r) === assetType)
    .filter((r) => tenantId === "__all__" || r.tenantId === tenantId)
    .filter((r) => !query || `${r.description} ${r.category} ${r.tenantName ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .filter((r) => !needsAttentionOnly || r.needsAttention)
    .filter((r) => !anyTypeFilter || (typeFilter.income && r.amount > 0) || (typeFilter.expense && r.amount < 0))
    .filter(
      (r) =>
        !anySourceFilter ||
        (sourceFilter.manual && r.source === "Manual") ||
        (sourceFilter.email && r.source === "Email") ||
        (sourceFilter.upload && r.source === "Upload"),
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const totalIncome = filtered.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalExpenses = filtered.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
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
    const map = new Map<string, TxRow[]>();
    for (const r of filtered) {
      const key = groupBy === "month" ? r.date.slice(0, 7) : ausFinancialYear(r.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // Most recent group first, matching the flat (ungrouped) list's own sort order.
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered, groupBy]);

  const exportCsv = () => {
    const header = ["Date", "Description", "Category", "Tenant", "Source", "Asset", "Amount"];
    const rows = filtered.map((r) => {
      const prop = state.properties.find((p) => p.id === r.propertyId);
      const asset = state.assets.find((a) => a.id === r.assetId);
      return [r.date, r.description, r.category, r.tenantName ?? "", r.source ?? "", prop?.alias || prop?.address || asset?.name || "", r.amount];
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
            </SelectContent>
          </Select>
          {!lockedPropertyId && (
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All properties</SelectItem>
                {state.properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.alias || p.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!lockedPropertyId && (
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
                .filter((t) => propertyId === "__all__" || t.propertyId === propertyId)
                .map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
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
              <DropdownMenuCheckboxItem checked={sourceFilter.email} onCheckedChange={(v) => setSourceFilter((f) => ({ ...f, email: v === true }))}>
                Email
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={sourceFilter.upload} onCheckedChange={(v) => setSourceFilter((f) => ({ ...f, upload: v === true }))}>
                Upload
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" className="gap-1" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <AddTransactionDialog propertyId={lockedPropertyId} />
        </div>
      </div>

      <NeedsReviewBanner />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            {groupBy === "none" || !groups ? (
              <TxTable rows={filtered} lockedPropertyId={lockedPropertyId} />
            ) : (
              <div className="space-y-2 p-2">
                {groups.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground">No transactions match these filters.</div>
                )}
                {groups.map(([key, groupRows]) => (
                  <TxGroupSection
                    key={key}
                    label={groupBy === "month" ? formatMonthLabel(key) : `FY ${key}`}
                    rows={groupRows}
                    lockedPropertyId={lockedPropertyId}
                  />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                {filtered.length} of {(fy === "all" ? allRows : allRows.filter((r) => r.date >= start && r.date <= end)).length} transactions
              </span>
              <span>
                Income <span className="text-emerald-600">{fmtCurrency(totalIncome)}</span> · Expenses{" "}
                <span className="text-destructive">{fmtCurrency(Math.abs(totalExpenses))}</span>
              </span>
            </div>
          </Card>
        </div>

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
              <div className="mt-2 flex justify-between border-t pt-2">
                <span className="font-medium">Net</span>
                <span className="font-semibold">{fmtCurrency(totalIncome + totalExpenses)}</span>
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
      </div>
    </div>
  );
}

function TxTable({ rows, lockedPropertyId }: { rows: TxRow[]; lockedPropertyId?: string }) {
  const { state, deleteExpense } = useStore();
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <Receipt className="mx-auto mb-2 h-6 w-6" />
        No transactions in this period.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Tenant</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="w-16 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const prop = state.properties.find((p) => p.id === r.propertyId);
            const asset = state.assets.find((a) => a.id === r.assetId);
            const label = lockedPropertyId ? undefined : prop?.alias || prop?.address || asset?.name;
            const expense = r.expenseId ? state.expenses.find((e) => e.id === r.expenseId) : undefined;
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="whitespace-nowrap px-3 py-2 text-xs">{r.date}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    {r.needsAttention && <TriangleAlert className="h-3 w-3 shrink-0 text-amber-600" />}
                    {r.description}
                  </div>
                  {label && <div className="text-xs text-muted-foreground">{label}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.category}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.tenantName ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {r.sourceFileData ? (
                    <a
                      href={r.sourceFileData}
                      download={r.sourceFileName || "document.pdf"}
                      className="inline-flex items-center gap-1 text-primary underline"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="max-w-[140px] truncate">{r.sourceFileName || "Document"}</span>
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{r.source ?? "—"}</span>
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-medium ${r.amount < 0 ? "text-destructive" : "text-emerald-600"}`}>
                  {r.amount < 0 ? "−" : "+"}
                  {fmtCurrency(Math.abs(r.amount))}
                </td>
                <td className="px-2 py-2">
                  {expense && (
                    <div className="flex items-center justify-end gap-0.5">
                      <ExpenseDialog
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
}: {
  label: string;
  rows: TxRow[];
  lockedPropertyId?: string;
}) {
  const [open, setOpen] = useState(false);
  const income = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const expenses = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm">
          <span className="flex items-center gap-2 font-medium">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {label}
          </span>
          <span className="flex gap-3 text-xs text-muted-foreground">
            <span className="text-emerald-600">Income {fmtCurrency(income)}</span>
            <span className="text-destructive">Expenses {fmtCurrency(Math.abs(expenses))}</span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <TxTable rows={rows} lockedPropertyId={lockedPropertyId} />
      </CollapsibleContent>
    </Collapsible>
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

      const agent = state.providers.find((p) => p.propertyId === prop.id && p.role === "Agent");
      if (agent && hasFeeTerms(agent)) {
        const results = verifyAgentFees({ provider: agent, rentCollected, lines: collectAgentFeeLines(expenses) });
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
                <Stat label="Gross rent collected" value={fmtCurrency(report.gross)} />
                <Stat label="Total deductible (Running Expenses)" value={fmtCurrency(report.total)} />
                <Stat label="Loan interest (est.)" value={fmtCurrency(report.interest)} />
                <Stat
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 font-medium " + (strong ? "text-base " : "") + (negative ? "text-destructive" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
