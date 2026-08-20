import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { fmtCurrency } from "@/lib/calculations";
import {
  ArrowLeft,
  LayoutDashboard,
  Building2,
  ShoppingCart,
  TrendingUp,
  Receipt,
  Landmark,
  Calculator,
  LineChart,
  FileText,
  ShieldCheck,
  Users2,
  ImageIcon,
} from "lucide-react";
import {
  PropertyOverviewTab,
  PropertyDetailsTab,
  PropertyPurchaseTab,
  PropertyPerformanceTab,
  PropertyBillsTab,
  PropertyCostBaseTab,
  DepreciationTab,
  PropertyPnLTab,
  PropertyComplianceTab,
  PropertyProvidersTab,
  PropertyMediaTab,
} from "@/components/PropertyShared";

export const Route = createFileRoute("/assets_/$assetId")({
  head: () => ({
    meta: [{ title: "Property — Landlord OS" }],
  }),
  component: PropertyAssetPage,
});

type Section =
  | "overview"
  | "details"
  | "purchase"
  | "performance"
  | "transactions"
  | "bills"
  | "loans"
  | "costbase"
  | "depreciation"
  | "pnl"
  | "compliance"
  | "providers"
  | "media";

const NAV: { section: Section; label: string; icon: React.ComponentType<{ className?: string }>; group?: string }[] = [
  { section: "overview", label: "Overview", icon: LayoutDashboard },
  { section: "details", label: "Property Details", icon: Building2 },
  { section: "purchase", label: "Purchase & Settlement", icon: ShoppingCart },
  { section: "performance", label: "Performance", icon: TrendingUp },
  { section: "transactions", label: "Transactions", icon: Receipt, group: "Finance" },
  { section: "bills", label: "Bills", icon: Receipt, group: "Finance" },
  { section: "loans", label: "Loans", icon: Landmark, group: "Finance" },
  { section: "costbase", label: "Cost Base", icon: Calculator, group: "Finance" },
  { section: "depreciation", label: "Depreciation", icon: LineChart, group: "Finance" },
  { section: "pnl", label: "P&L", icon: FileText, group: "Finance" },
  { section: "compliance", label: "Compliance", icon: ShieldCheck },
  { section: "providers", label: "Providers", icon: Users2 },
  { section: "media", label: "Media", icon: ImageIcon },
];

function PropertyTransactionsTab({ propertyId, tenantIds }: { propertyId: string; tenantIds: string[] }) {
  const { state } = useStore();
  const rows = [
    ...state.expenses
      .filter((e) => e.propertyId === propertyId)
      .map((e) => ({
        id: `exp_${e.id}`,
        date: e.date,
        description: e.itemName,
        category: e.taxCategory,
        amount: e.direction === "Income" ? e.cost : -e.cost,
      })),
    ...state.ledger
      .filter((e) => tenantIds.includes(e.tenantId) && e.credit > 0)
      .map((e) => ({
        id: `ledg_${e.id}`,
        date: e.date,
        description: e.type,
        category: e.type,
        amount: e.credit,
      })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="space-y-2 text-sm">
      {rows.length === 0 && <div className="text-xs text-muted-foreground">No transactions for this property yet.</div>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded border p-2 text-xs">
          <div>
            <div className="font-medium">{r.description}</div>
            <div className="text-muted-foreground">
              {r.date} • {r.category}
            </div>
          </div>
          <div className={r.amount < 0 ? "text-destructive" : "text-emerald-600"}>
            {r.amount < 0 ? "−" : "+"}
            {fmtCurrency(Math.abs(r.amount))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PropertyLoansTab({ propertyId }: { propertyId: string }) {
  const { state } = useStore();
  const loans = state.loans.filter((l) => l.propertyId === propertyId);
  return (
    <div className="space-y-2 text-sm">
      {loans.length === 0 && <div className="text-xs text-muted-foreground">No loans on file for this property.</div>}
      {loans.map((l) => (
        <div key={l.id} className="rounded border p-3 text-xs">
          <div className="font-medium">{l.bankName}</div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
            <span>Balance: {fmtCurrency(l.totalBalance)}</span>
            <span>Rate: {l.interestRate}%</span>
            <span>EMI: {fmtCurrency(l.monthlyEmi)}</span>
            <span>Offset: {l.offsetBalance ? fmtCurrency(l.offsetBalance) : "—"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PropertyAssetPage() {
  const { assetId } = Route.useParams();
  const { state, loading } = useStore();
  const [section, setSection] = useState<Section>("overview");

  const asset = state.assets.find((a) => a.id === assetId);
  const prop = asset?.linkedPropertyId ? state.properties.find((p) => p.id === asset.linkedPropertyId) : undefined;

  // On first paint (SSR, or the moment before the client's initial Supabase fetch resolves),
  // state.assets/state.properties are still empty — without this check every property page
  // would flash "This page is for property assets only" before its own data ever loaded.
  if (loading && (!asset || !prop)) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-primary underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Assets
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      </div>
    );
  }

  if (!asset || asset.assetType !== "Property" || !prop) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-primary underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Assets
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            This page is for property assets only.
          </CardContent>
        </Card>
      </div>
    );
  }

  const loan = state.loans.find((l) => l.propertyId === prop.id);
  const tenants = state.tenants.filter((t) => t.propertyId === prop.id);
  const tenantIds = tenants.map((t) => t.id);
  const expenses = state.expenses.filter((e) => e.propertyId === prop.id);
  const depreciationItems = state.depreciationItems.filter((d) => d.assetId === asset.id);

  const groups: { group: string | null; items: typeof NAV }[] = [];
  for (const item of NAV) {
    const key = item.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.group === key) last.items.push(item);
    else groups.push({ group: key, items: [item] });
  }

  return (
    <div className="flex min-h-[calc(100vh-1px)] flex-col sm:flex-row">
      <div className="w-full shrink-0 border-b p-3 sm:w-56 sm:border-b-0 sm:border-r sm:p-4">
        <Link to="/assets" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> All assets
        </Link>
        <div className="mb-3">
          <div className="font-semibold leading-tight">{prop.alias || prop.address}</div>
          {prop.alias && <div className="text-xs text-muted-foreground">{prop.address}</div>}
        </div>
        <nav className="space-y-3">
          {groups.map((g, i) => (
            <div key={i}>
              {g.group && (
                <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {g.group}
                </div>
              )}
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <button
                    key={item.section}
                    type="button"
                    onClick={() => setSection(item.section)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      section === item.section ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          Portfolio-wide:{" "}
          <Link to="/transactions" className="underline">
            Reports
          </Link>
          {" · "}
          <Link to="/forecasts" className="underline">
            Forecasts
          </Link>
          {" · "}
          <Link to="/buffers" className="underline">
            Buffers
          </Link>
        </div>
      </div>

      <div className="min-w-0 flex-1 p-4 sm:p-6">
        {section === "overview" && <PropertyOverviewTab prop={prop} loan={loan} tenants={tenants} />}
        {section === "details" && <PropertyDetailsTab prop={prop} expenses={expenses} tenants={tenants} />}
        {section === "purchase" && <PropertyPurchaseTab prop={prop} loan={loan} />}
        {section === "performance" && <PropertyPerformanceTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />}
        {section === "transactions" && <PropertyTransactionsTab propertyId={prop.id} tenantIds={tenantIds} />}
        {section === "bills" && <PropertyBillsTab propertyId={prop.id} />}
        {section === "loans" && <PropertyLoansTab propertyId={prop.id} />}
        {section === "costbase" && <PropertyCostBaseTab prop={prop} expenses={expenses} depreciationItems={depreciationItems} />}
        {section === "depreciation" && <DepreciationTab assetId={asset.id} />}
        {section === "pnl" && <PropertyPnLTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />}
        {section === "compliance" && <PropertyComplianceTab prop={prop} />}
        {section === "providers" && <PropertyProvidersTab propertyId={prop.id} />}
        {section === "media" && <PropertyMediaTab prop={prop} />}
      </div>
    </div>
  );
}
