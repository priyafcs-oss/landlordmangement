import { Fragment, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { BillDetailDialog } from "@/components/BillDetailDialog";
import { SortableTh, toggleSort, type SortState } from "@/components/SortableTh";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, MoreVertical, PanelRightClose, PanelRightOpen, Receipt, Search } from "lucide-react";
import { fmtCurrency, todayISO, CATEGORY_GROUPS, taxTreatmentLabel } from "@/lib/calculations";
import type { AssetType, BillType, ExpenseCategory, PropertyBill } from "@/lib/types";
import { toast } from "sonner";

const STATUS_OPTIONS = ["__all__", "Unpaid", "Overdue", "Paid"] as const;
const BILL_TYPES: BillType[] = ["Water", "Council Rates", "Strata", "Insurance", "Electricity", "Gas", "Other"];
const TYPE_COLORS = ["bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-cyan-500", "bg-slate-500"];

type SortField = "dueDate" | "description" | "provider" | "property" | "tenant" | "category" | "taxTreatment" | "source" | "amount";

interface RowHelpers {
  showPropertyFilter: boolean;
  isOverdue: (b: PropertyBill) => boolean;
  propertyLabelOf: (b: PropertyBill) => string | undefined;
  tenantLabelOf: (b: PropertyBill) => string | undefined;
  markBillPaid: (id: string, opts?: { paidDate?: string }) => void;
  deleteBill: (id: string) => void;
}

/**
 * The Bills table + Insights sidebar — used both portfolio-wide (/bills, every filter shown, a
 * Property column) and scoped to one property (the property detail page's Bills section, no
 * property/asset-type filters or column since it's already implied). `bills` is pre-scoped by the
 * caller; this only ever adds status/type/search filtering on top.
 */
export function BillsBoard({
  bills,
  showPropertyFilter = true,
}: {
  bills: PropertyBill[];
  /** Show the Property/Asset type filter dropdowns and the Property column. Off for a single-property view. */
  showPropertyFilter?: boolean;
}) {
  const { state, markBillPaid, deleteBill } = useStore();
  const [propertyId, setPropertyId] = useState("__all__");
  const [assetType, setAssetType] = useState<"__all__" | AssetType>("__all__");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("__all__");
  const [billType, setBillType] = useState<"__all__" | BillType>("__all__");
  const [category, setCategory] = useState<"__all__" | ExpenseCategory>("__all__");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<SortField> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<"none" | "provider" | "category">("none");
  // Hidden by default so the table gets the full width — the insights sidebar is a nice-to-have,
  // not what a landlord scanning bills is looking at first.
  const [showInsights, setShowInsights] = useState(() => {
    try {
      return localStorage.getItem("billsInsightsVisible") === "1";
    } catch {
      return false;
    }
  });
  const toggleInsights = () => {
    setShowInsights((v) => {
      const next = !v;
      try {
        localStorage.setItem("billsInsightsVisible", next ? "1" : "0");
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  };

  const today = todayISO();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const isOverdue = (b: PropertyBill) => b.status === "Unpaid" && b.dueDate < today;
  const assetTypeOf = (b: PropertyBill) => state.assets.find((a) => a.id === b.assetId)?.assetType;
  const propertyLabelOf = (b: PropertyBill) => {
    const p = state.properties.find((pr) => pr.id === b.propertyId);
    return p?.alias || p?.address || state.assets.find((a) => a.id === b.assetId)?.name;
  };
  /** A bill has no direct tenantId of its own — only individual line items that were recharged do
   * — so this joins every distinct recharged tenant's name across the bill's line items. */
  const tenantLabelOf = (b: PropertyBill) => {
    const ids = [...new Set((b.lineItems ?? []).map((li) => li.tenantId).filter((id): id is string => !!id))];
    if (ids.length === 0) return undefined;
    return ids.map((id) => state.tenants.find((t) => t.id === id)?.name).filter(Boolean).join(", ") || undefined;
  };

  const sortValue = (b: PropertyBill, field: SortField): string | number => {
    switch (field) {
      case "dueDate":
        return b.dueDate;
      case "description":
        return b.billType;
      case "provider":
        return b.providerName ?? "";
      case "property":
        return propertyLabelOf(b) ?? "";
      case "tenant":
        return tenantLabelOf(b) ?? "";
      case "category":
        return b.category ?? "";
      case "taxTreatment":
        return taxTreatmentLabel(b.category);
      case "source":
        return b.source ?? "Manual";
      case "amount":
        return b.amount;
    }
  };

  const filtered = bills
    .filter((b) => !showPropertyFilter || propertyId === "__all__" || b.propertyId === propertyId)
    .filter((b) => !showPropertyFilter || assetType === "__all__" || assetTypeOf(b) === assetType)
    .filter((b) => billType === "__all__" || b.billType === billType)
    .filter((b) => category === "__all__" || b.category === category)
    .filter((b) => {
      if (status === "__all__") return true;
      if (status === "Overdue") return isOverdue(b);
      if (status === "Unpaid") return b.status === "Unpaid" && !isOverdue(b);
      return b.status === "Paid";
    })
    .filter((b) => {
      if (!query) return true;
      const haystack = `${b.billType} ${b.providerName ?? ""} ${propertyLabelOf(b) ?? ""} ${tenantLabelOf(b) ?? ""}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    })
    .sort((a, b) => {
      if (!sort) return a.dueDate < b.dueDate ? -1 : 1;
      const av = sortValue(a, sort.field);
      const bv = sortValue(b, sort.field);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });

  const toggleExpanded = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, PropertyBill[]>();
    for (const b of filtered) {
      const key = groupBy === "provider" ? b.providerName || "No provider" : b.category || "Uncategorised";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  const helpers: RowHelpers = { showPropertyFilter, isOverdue, propertyLabelOf, tenantLabelOf, markBillPaid, deleteBill };
  const handleSort = (f: SortField) => setSort((s) => toggleSort(s, f));

  const outstanding = bills.filter((b) => b.status !== "Paid");
  const outstandingTotal = outstanding.reduce((s, b) => s + b.amount, 0);
  const overdueTotal = outstanding.filter(isOverdue).reduce((s, b) => s + b.amount, 0);
  const due30Total = outstanding.filter((b) => !isOverdue(b) && b.dueDate <= in30).reduce((s, b) => s + b.amount, 0);
  const laterTotal = outstandingTotal - overdueTotal - due30Total;
  const byType = outstanding.reduce<Record<string, number>>((acc, b) => {
    acc[b.billType] = (acc[b.billType] ?? 0) + b.amount;
    return acc;
  }, {});
  const maxByType = Math.max(1, ...Object.values(byType));

  const overduePct = outstandingTotal > 0 ? (overdueTotal / outstandingTotal) * 100 : 0;
  const due30Pct = outstandingTotal > 0 ? (due30Total / outstandingTotal) * 100 : 0;
  const gaugeCircumference = 2 * Math.PI * 40;

  return (
    <div className={showInsights ? "grid gap-4 lg:grid-cols-3" : "grid gap-4"}>
      <div className={showInsights ? "space-y-3 lg:col-span-2" : "space-y-3"}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search bills…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-[180px] pl-7" />
          </div>
          {showPropertyFilter && (
            <>
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
            </>
          )}
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="Unpaid">Unpaid</SelectItem>
              <SelectItem value="Overdue">Overdue</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
            </SelectContent>
          </Select>
          <Select value={billType} onValueChange={(v) => setBillType(v as typeof billType)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {BILL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
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
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No grouping</SelectItem>
              <SelectItem value="provider">By provider</SelectItem>
              <SelectItem value="category">By category</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={toggleInsights}>
            {showInsights ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            {showInsights ? "Hide insights" : "Show insights"}
          </Button>
        </div>

        <Card>
          {groupBy === "none" || !groups ? (
            <BillsTableBody rows={filtered} sort={sort} onSort={handleSort} expanded={expanded} toggleExpanded={toggleExpanded} {...helpers} />
          ) : (
            <div className="space-y-2 p-2">
              {groups.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">No bills match these filters.</div>
              )}
              {groups.map(([key, groupRows]) => (
                <BillGroupSection
                  key={key}
                  label={key}
                  rows={groupRows}
                  sort={sort}
                  onSort={handleSort}
                  expanded={expanded}
                  toggleExpanded={toggleExpanded}
                  {...helpers}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {showInsights && (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outstanding</CardTitle>
            <div className="text-xs text-muted-foreground">{outstanding.length} unpaid bill{outstanding.length === 1 ? "" : "s"}</div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
                {outstandingTotal > 0 && (
                  <>
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="hsl(var(--destructive))"
                      strokeWidth="10"
                      strokeDasharray={`${(overduePct / 100) * gaugeCircumference} ${gaugeCircumference}`}
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="10"
                      strokeDasharray={`${(due30Pct / 100) * gaugeCircumference} ${gaugeCircumference}`}
                      strokeDashoffset={-((overduePct / 100) * gaugeCircumference)}
                    />
                  </>
                )}
              </svg>
              <div>
                <div className="text-2xl font-semibold tracking-tight">{fmtCurrency(outstandingTotal)}</div>
                <div className="text-xs text-muted-foreground">{showPropertyFilter ? "due across the portfolio" : "due on this property"}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" /> Overdue</span>
                <span>{fmtCurrency(overdueTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Due in 30 days</span>
                <span>{fmtCurrency(due30Total)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Later</span>
                <span>{fmtCurrency(laterTotal)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By type</CardTitle>
            <div className="text-xs text-muted-foreground">Outstanding by bill type</div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.keys(byType).length === 0 && <div className="text-xs text-muted-foreground">Nothing outstanding.</div>}
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, amount], idx) => (
                <div key={type}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{type}</span>
                    <span className="font-medium">{fmtCurrency(amount)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                    <div
                      className={"h-1.5 rounded-full " + TYPE_COLORS[idx % TYPE_COLORS.length]}
                      style={{ width: `${(amount / maxByType) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
      )}
    </div>
  );
}

/** One "By provider"/"By category" bucket — a collapsible section wrapping the same table body
 * used for the flat (ungrouped) view, so instalment grouping/sorting/actions behave identically
 * whether or not an outer grouping is applied. */
function BillGroupSection({
  label,
  rows,
  sort,
  onSort,
  expanded,
  toggleExpanded,
  ...helpers
}: RowHelpers & {
  label: string;
  rows: PropertyBill[];
  sort: SortState<SortField> | null;
  onSort: (field: SortField) => void;
  expanded: Set<string>;
  toggleExpanded: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = rows.reduce((s, b) => s + b.amount, 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm">
          <span className="flex items-center gap-2 font-medium">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {label}
          </span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-normal">
              {rows.length} bill{rows.length === 1 ? "" : "s"}
            </Badge>
            <span className="font-medium text-foreground">{fmtCurrency(total)}</span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <BillsTableBody rows={rows} sort={sort} onSort={onSort} expanded={expanded} toggleExpanded={toggleExpanded} {...helpers} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function BillsTableBody({
  rows,
  sort,
  onSort,
  expanded,
  toggleExpanded,
  showPropertyFilter,
  isOverdue,
  propertyLabelOf,
  tenantLabelOf,
  markBillPaid,
  deleteBill,
}: RowHelpers & {
  rows: PropertyBill[];
  sort: SortState<SortField> | null;
  onSort: (field: SortField) => void;
  expanded: Set<string>;
  toggleExpanded: (key: string) => void;
}) {
  // Instalments created from one Add Bill submission share a billGroupId — grouped into a single
  // collapsible row here instead of showing each one flat, so a 3-instalment council notice reads
  // as one line item until expanded. Grouping runs after filtering/sorting (rows arrives already
  // sorted from the caller), so a filter that only matches one instalment (e.g. status=Overdue)
  // still degrades gracefully to a singleton "group".
  const groupedRows = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; group: PropertyBill[] }[] = [];
    for (const b of rows) {
      if (seen.has(b.id)) continue;
      if (b.billGroupId) {
        const group = rows
          .filter((x) => x.billGroupId === b.billGroupId)
          .sort((a, c) => (a.dueDate < c.dueDate ? -1 : a.dueDate > c.dueDate ? 1 : 0));
        group.forEach((g) => seen.add(g.id));
        out.push({ key: b.billGroupId, group });
      } else {
        seen.add(b.id);
        out.push({ key: b.id, group: [b] });
      }
    }
    return out;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <Receipt className="mx-auto mb-2 h-6 w-6" />
        No bills match these filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <SortableTh field="dueDate" label="Due Date" sort={sort} onSort={onSort} />
            <SortableTh field="description" label="Description" sort={sort} onSort={onSort} />
            <SortableTh field="provider" label="Provider" sort={sort} onSort={onSort} />
            {showPropertyFilter && <SortableTh field="property" label="Property" sort={sort} onSort={onSort} />}
            <SortableTh field="tenant" label="Tenant" sort={sort} onSort={onSort} />
            <SortableTh field="category" label="Category" sort={sort} onSort={onSort} />
            <SortableTh field="taxTreatment" label="Tax Treatment" sort={sort} onSort={onSort} />
            <SortableTh field="source" label="Source" sort={sort} onSort={onSort} />
            <SortableTh field="amount" label="Amount" align="right" sort={sort} onSort={onSort} />
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {groupedRows.map(({ key, group }) => {
            if (group.length === 1) {
              return (
                <BillTableRow
                  key={key}
                  b={group[0]}
                  showPropertyFilter={showPropertyFilter}
                  isOverdue={isOverdue}
                  propertyLabelOf={propertyLabelOf}
                  tenantLabelOf={tenantLabelOf}
                  markBillPaid={markBillPaid}
                  deleteBill={deleteBill}
                />
              );
            }
            const isOpen = expanded.has(key);
            const total = group.reduce((s, b) => s + b.amount, 0);
            const paidCount = group.filter((b) => b.status === "Paid").length;
            const allPaid = paidCount === group.length;
            const anyOverdue = group.some(isOverdue);
            const nextDue = group.find((b) => b.status !== "Paid")?.dueDate ?? group[0].dueDate;
            const primary = group[0];
            return (
              <Fragment key={key}>
                <tr className="border-b bg-muted/20 hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{nextDue}</td>
                  <td className="px-3 py-2">
                    <button type="button" className="flex items-center gap-1.5 text-left hover:underline" onClick={() => toggleExpanded(key)}>
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                      <div>
                        <div className="font-medium">
                          {showPropertyFilter ? propertyLabelOf(primary) ?? primary.billType : primary.billType}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {showPropertyFilter ? primary.billType : ""} · {group.length} instalments
                          {allPaid ? " · all paid" : ` · ${paidCount}/${group.length} paid`}
                          {anyOverdue ? " · overdue" : ""}
                        </div>
                      </div>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs">{primary.providerName ?? "—"}</td>
                  {showPropertyFilter && (
                    <td className="px-3 py-2 text-xs text-muted-foreground">{propertyLabelOf(primary) ?? "—"}</td>
                  )}
                  <td className="px-3 py-2 text-xs text-muted-foreground">{tenantLabelOf(primary) ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{primary.category ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{taxTreatmentLabel(primary.category)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{primary.source ?? "Manual"}</td>
                  <td className={"px-3 py-2 text-right font-medium " + (anyOverdue ? "text-destructive" : "")}>{fmtCurrency(total)}</td>
                  <td className="px-2 py-2" />
                </tr>
                {isOpen &&
                  group.map((b) => (
                    <BillTableRow
                      key={b.id}
                      b={b}
                      indent
                      showPropertyFilter={showPropertyFilter}
                      isOverdue={isOverdue}
                      propertyLabelOf={propertyLabelOf}
                      tenantLabelOf={tenantLabelOf}
                      markBillPaid={markBillPaid}
                      deleteBill={deleteBill}
                    />
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BillTableRow({
  b,
  indent,
  showPropertyFilter,
  isOverdue,
  propertyLabelOf,
  tenantLabelOf,
  markBillPaid,
  deleteBill,
}: {
  b: PropertyBill;
  indent?: boolean;
  showPropertyFilter: boolean;
  isOverdue: (b: PropertyBill) => boolean;
  propertyLabelOf: (b: PropertyBill) => string | undefined;
  tenantLabelOf: (b: PropertyBill) => string | undefined;
  markBillPaid: (id: string, opts?: { paidDate?: string }) => void;
  deleteBill: (id: string) => void;
}) {
  const overdue = isOverdue(b);
  return (
    <tr className={"border-b last:border-0 hover:bg-muted/30" + (indent ? " bg-muted/5" : "")}>
      <td className="whitespace-nowrap px-3 py-2 text-xs">{b.dueDate}</td>
      <td className={"px-3 py-2" + (indent ? " pl-8" : "")}>
        <BillDetailDialog
          bill={b}
          propertyLabel={propertyLabelOf(b)}
          trigger={
            <button type="button" className="text-left hover:underline">
              <div className="font-medium">{indent ? b.label ?? b.billType : showPropertyFilter ? propertyLabelOf(b) ?? b.billType : b.billType}</div>
              <div className="text-xs text-muted-foreground">
                {indent ? "" : showPropertyFilter ? b.billType : ""}
                {!indent && b.label ? ` · ${b.label}` : ""}
                {b.status === "Paid" ? " · paid" : overdue ? " · overdue" : ""}
              </div>
            </button>
          }
        />
      </td>
      <td className="px-3 py-2 text-xs">{b.providerName ?? "—"}</td>
      {showPropertyFilter && <td className="px-3 py-2 text-xs text-muted-foreground">{propertyLabelOf(b) ?? "—"}</td>}
      <td className="px-3 py-2 text-xs text-muted-foreground">{tenantLabelOf(b) ?? "—"}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{b.category ?? "—"}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{taxTreatmentLabel(b.category)}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{b.source ?? "Manual"}</td>
      <td className={"px-3 py-2 text-right font-medium " + (overdue ? "text-destructive" : "")}>{fmtCurrency(b.amount)}</td>
      <td className="px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {b.status !== "Paid" && (
              <DropdownMenuItem
                onClick={() => {
                  markBillPaid(b.id);
                  toast.success("Marked paid — posted to Transactions" + (b.recurrenceMonths ? " · next cycle scheduled" : ""));
                }}
              >
                <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Mark paid
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => {
                if (confirm(`Delete this ${b.billType} bill?`)) {
                  deleteBill(b.id);
                  toast.success("Bill removed");
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
