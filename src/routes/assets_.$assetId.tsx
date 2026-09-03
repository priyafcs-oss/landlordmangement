import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtCurrency } from "@/lib/calculations";
import {
  ArrowLeft,
  LayoutDashboard,
  Building2,
  ShoppingCart,
  Receipt,
  Landmark,
  Calculator,
  LineChart,
  FileText,
  FolderOpen,
  ShieldCheck,
  BadgeCheck,
  Users2,
  ImageIcon,
  Pencil,
  Wrench,
  StickyNote,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { usePersistedToggle } from "@/lib/hooks";
import {
  PropertySummaryTab,
  PropertyDetailsTab,
  PropertyPurchaseTab,
  PropertyBillsTab,
  PropertyCostBaseTab,
  DepreciationTab,
  PropertyPnLTab,
  PropertyTenancyTab,
  PropertyProvidersTab,
  PropertyMediaTab,
  PropertyDialog,
  DeletePropertyDialog,
} from "@/components/PropertyShared";
import { PropertyInsuranceTab, PropertyMaintenanceTab, PropertyCertificatesTab, PropertyNotesTab } from "@/components/PropertyExtraTabs";
import { LedgerTab } from "@/routes/transactions";
import { DocumentsContent } from "@/routes/documents";
import { buildDocumentEntries } from "@/lib/documents";
import { DocumentsSection } from "@/components/DocumentEntryRow";

export const Route = createFileRoute("/assets_/$assetId")({
  head: () => ({
    meta: [{ title: "Property — Landlord OS" }],
  }),
  component: PropertyAssetPage,
});

type Section =
  | "summary"
  | "purchase"
  | "transactions"
  | "bills"
  | "loans"
  | "costbase"
  | "depreciation"
  | "pnl"
  | "providers"
  | "tenancy"
  | "insurance"
  | "maintenance"
  | "compliance"
  | "details"
  | "documents"
  | "photos"
  | "notes";

const NAV: { section: Section; label: string; icon: React.ComponentType<{ className?: string }>; group?: string }[] = [
  { section: "summary", label: "Performance & Summary", icon: LayoutDashboard },
  { section: "purchase", label: "Purchase & Acquisition", icon: ShoppingCart },
  { section: "providers", label: "Providers", icon: Users2 },
  { section: "transactions", label: "Transactions", icon: Receipt, group: "Finance" },
  { section: "bills", label: "Bills", icon: Receipt, group: "Finance" },
  { section: "loans", label: "Loans", icon: Landmark, group: "Finance" },
  { section: "costbase", label: "Cost Base", icon: Calculator, group: "Finance" },
  { section: "depreciation", label: "Depreciation", icon: LineChart, group: "Finance" },
  { section: "pnl", label: "P&L", icon: FileText, group: "Finance" },
  { section: "tenancy", label: "Tenancy", icon: BadgeCheck, group: "Property" },
  { section: "insurance", label: "Insurance", icon: ShieldCheck, group: "Property" },
  { section: "maintenance", label: "Maintenance", icon: Wrench, group: "Property" },
  { section: "compliance", label: "Compliance", icon: ShieldCheck, group: "Property" },
  { section: "details", label: "Details", icon: Building2, group: "Property" },
  { section: "documents", label: "Other documents", icon: FolderOpen, group: "Property" },
  { section: "photos", label: "Photos", icon: ImageIcon, group: "Property" },
  { section: "notes", label: "Notes", icon: StickyNote, group: "Property" },
];

function PropertyLoansTab({ propertyId }: { propertyId: string }) {
  const { state } = useStore();
  const loans = state.loans.filter((l) => l.propertyId === propertyId);
  const documents = buildDocumentEntries(state).filter(
    (e) => e.propertyId === propertyId && (e.kind === "Loan Document" || e.kind === "Loan Statement"),
  );
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
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
      <DocumentsSection title="Documents" entries={documents} />
    </div>
  );
}

function PropertyAssetPage() {
  const { assetId } = Route.useParams();
  const { state, loading } = useStore();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>("summary");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, toggleSidebar] = usePersistedToggle("assetSidebarCollapsed");
  const toggleGroup = (group: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const asset = state.assets.find((a) => a.id === assetId);
  // Looked up both directions (Asset.linkedPropertyId -> Property.id, and Property.assetId ->
  // Asset.id) rather than only the forward direction — the two are meant to be kept in sync by
  // the store's addProperty/updateProperty, but a property saved before that mirror existed, or
  // one whose mirror update silently no-op'd, can leave them pointing at each other only one way.
  const prop = asset ? state.properties.find((p) => p.id === asset.linkedPropertyId || p.assetId === asset.id) : undefined;

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
      <div className={`shrink-0 border-b p-3 sm:border-b-0 sm:border-r sm:p-4 ${sidebarCollapsed ? "sm:w-14" : "w-full sm:w-56"}`}>
        <div className="mb-3 flex items-center justify-between gap-1">
          {!sidebarCollapsed && (
            <Link to="/assets" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> All assets
            </Link>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {!sidebarCollapsed && (
          <div className="mb-3 flex items-start justify-between gap-1">
            <div>
              <div className="font-semibold leading-tight">{prop.alias || prop.address}</div>
              {prop.alias && <div className="text-xs text-muted-foreground">{prop.address}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <PropertyDialog
                property={prop}
                onDone={() => {}}
                trigger={
                  <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0">
                    <Pencil className="h-3 w-3" />
                  </Button>
                }
              />
              <DeletePropertyDialog
                property={prop}
                onDeleted={(keptProperty) => {
                  if (keptProperty) setSection("summary");
                  else void navigate({ to: "/assets" });
                }}
              />
            </div>
          </div>
        )}
        <nav className="space-y-3">
          {groups.map((g, i) => {
            const collapsed = g.group ? collapsedGroups.has(g.group) : false;
            return (
              <div key={i}>
                {g.group && !sidebarCollapsed ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.group!)}
                    className="mb-1 flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    {collapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
                    {g.group}
                  </button>
                ) : null}
                {(sidebarCollapsed || !collapsed) && (
                  <div className="space-y-0.5">
                    {g.items.map((item) => (
                      <button
                        key={item.section}
                        type="button"
                        onClick={() => setSection(item.section)}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${sidebarCollapsed ? "justify-center" : ""} ${
                          section === item.section ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"
                        }`}
                      >
                        <item.icon className="h-3.5 w-3.5 shrink-0" />
                        {!sidebarCollapsed && item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {!sidebarCollapsed && (
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
        )}
      </div>

      <div className="min-w-0 flex-1 p-4 sm:p-6">
        {section === "summary" && <PropertySummaryTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />}
        {section === "purchase" && <PropertyPurchaseTab prop={prop} loan={loan} />}
        {section === "transactions" && <LedgerTab propertyId={prop.id} />}
        {section === "bills" && <PropertyBillsTab propertyId={prop.id} />}
        {section === "loans" && <PropertyLoansTab propertyId={prop.id} />}
        {section === "costbase" && <PropertyCostBaseTab prop={prop} expenses={expenses} depreciationItems={depreciationItems} />}
        {section === "depreciation" && <DepreciationTab assetId={asset.id} />}
        {section === "pnl" && <PropertyPnLTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />}
        {section === "providers" && <PropertyProvidersTab propertyId={prop.id} />}
        {section === "tenancy" && <PropertyTenancyTab propertyId={prop.id} />}
        {section === "insurance" && <PropertyInsuranceTab prop={prop} />}
        {section === "maintenance" && <PropertyMaintenanceTab prop={prop} />}
        {section === "compliance" && <PropertyCertificatesTab prop={prop} />}
        {section === "details" && <PropertyDetailsTab prop={prop} tenants={tenants} />}
        {section === "documents" && <DocumentsContent propertyId={prop.id} />}
        {section === "photos" && <PropertyMediaTab prop={prop} />}
        {section === "notes" && <PropertyNotesTab prop={prop} />}
      </div>
    </div>
  );
}
