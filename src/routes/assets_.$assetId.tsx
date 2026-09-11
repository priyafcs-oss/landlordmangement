import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtCurrency } from "@/lib/calculations";
import type { Loan } from "@/lib/types";
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
  FileUp,
  SlidersHorizontal,
  TrendingUp,
  Activity,
  Repeat,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  PropertySummaryTab,
  PropertyPerformanceTab,
  PropertyDetailsTab,
  PropertyPurchaseTab,
  PropertyBillsTab,
  PropertyCostBaseTab,
  DepreciationTab,
  PropertyCurrentFiguresTab,
  PropertyPnLTab,
  PropertyForecastsTab,
  PropertyTenancyTab,
  PropertyProvidersTab,
  PropertyMediaTab,
  PropertyDialog,
  DeletePropertyDialog,
} from "@/components/PropertyShared";
import {
  PropertyInsuranceTab,
  PropertyMaintenanceTab,
  PropertyCertificatesTab,
  PropertyNotesTab,
} from "@/components/PropertyExtraTabs";
import { LedgerTab } from "@/routes/transactions";
import { DocumentsContent } from "@/routes/documents";
import { buildDocumentEntries } from "@/lib/documents";
import { DocumentsSection } from "@/components/DocumentEntryRow";
import { AddLoanDialog } from "@/components/AddLoanDialog";
import { LoanStatementHistory } from "@/components/LoanStatementHistory";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import { AddLoanStatementDialog } from "@/components/AddLoanStatementDialog";
import { LoanCompiledFeed } from "@/components/LoanCompiledFeed";
import { OverviewSection } from "@/components/OverviewSection";

export const Route = createFileRoute("/assets_/$assetId")({
  head: () => ({
    meta: [{ title: "Property — Landlord OS" }],
  }),
  component: PropertyAssetPage,
});

type Section =
  | "overview"
  | "summary"
  | "performance"
  | "purchase"
  | "transactions"
  | "bills"
  | "loans"
  | "costbase"
  | "depreciation"
  | "currentFigures"
  | "pnl"
  | "forecasts"
  | "providers"
  | "tenancy"
  | "insurance"
  | "maintenance"
  | "compliance"
  | "details"
  | "documents"
  | "photos"
  | "notes";

const NAV: {
  section: Section;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
}[] = [
  { section: "overview", label: "Overview", icon: LayoutDashboard },
  { section: "summary", label: "Performance & Summary", icon: LayoutDashboard },
  { section: "performance", label: "Performance", icon: Activity },
  { section: "purchase", label: "Purchase & Acquisition", icon: ShoppingCart },
  { section: "providers", label: "Providers", icon: Users2 },
  { section: "transactions", label: "Transactions", icon: Receipt, group: "Finance" },
  { section: "bills", label: "Bills", icon: Receipt, group: "Finance" },
  { section: "loans", label: "Loans", icon: Landmark, group: "Finance" },
  { section: "costbase", label: "Cost Base", icon: Calculator, group: "Finance" },
  { section: "depreciation", label: "Depreciation", icon: LineChart, group: "Finance" },
  {
    section: "currentFigures",
    label: "Current Figures",
    icon: SlidersHorizontal,
    group: "Finance",
  },
  { section: "pnl", label: "P&L", icon: FileText, group: "Finance" },
  { section: "forecasts", label: "Forecasts", icon: TrendingUp, group: "Finance" },
  { section: "tenancy", label: "Tenancy", icon: BadgeCheck, group: "Property" },
  { section: "insurance", label: "Insurance", icon: ShieldCheck, group: "Property" },
  { section: "maintenance", label: "Maintenance", icon: Wrench, group: "Property" },
  { section: "compliance", label: "Compliance", icon: ShieldCheck, group: "Property" },
  { section: "details", label: "Details", icon: Building2, group: "Property" },
  { section: "documents", label: "Other documents", icon: FolderOpen, group: "Property" },
  { section: "photos", label: "Photos", icon: ImageIcon, group: "Property" },
  { section: "notes", label: "Notes", icon: StickyNote, group: "Property" },
];

function LoanCard({ l, propertyId, historic }: { l: Loan; propertyId: string; historic?: boolean }) {
  return (
    <div className={`rounded border p-3 text-xs ${historic ? "bg-muted/20" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          {l.bankName}
          {historic && (
            <Badge variant="outline" className="text-[10px] font-normal">
              Paid off
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <UploadDocumentDialog
            loanId={l.id}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Upload statement">
                <FileUp className="h-3 w-3" />
              </Button>
            }
          />
          <AddLoanStatementDialog loan={l} />
          {!historic && (
            <AddLoanDialog
              refinanceFrom={l}
              propertyId={propertyId}
              trigger={
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs">
                  <Repeat className="h-3 w-3" /> Refinance
                </Button>
              }
            />
          )}
          <AddLoanDialog
            loan={l}
            propertyId={propertyId}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
        </div>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
        <span>Balance: {fmtCurrency(l.totalBalance)}</span>
        <span>Rate: {l.interestRate}%</span>
        <span>EMI: {fmtCurrency(l.monthlyEmi)}</span>
        <span>Offset: {l.offsetBalance ? fmtCurrency(l.offsetBalance) : "—"}</span>
      </div>
      <div className="mt-2 space-y-2">
        <LoanStatementHistory loanId={l.id} />
        <LoanCompiledFeed loan={l} />
      </div>
    </div>
  );
}

function PropertyLoansTab({ propertyId }: { propertyId: string }) {
  const { state } = useStore();
  const [showHistory, setShowHistory] = useState(false);
  const loans = state.loans.filter((l) => l.propertyId === propertyId);
  // Refinancing keeps the old loan on record with status "Paid Off" instead of overwriting its
  // terms — kept out of the main list (which is otherwise the still-live loans a landlord checks
  // day to day) and tucked behind a collapsed "Loan history" toggle instead.
  const activeLoans = loans.filter((l) => l.status !== "Paid Off");
  const historicLoans = loans.filter((l) => l.status === "Paid Off");
  const documents = buildDocumentEntries(state).filter(
    (e) =>
      e.propertyId === propertyId && (e.kind === "Loan Document" || e.kind === "Loan Statement"),
  );
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">Loans</div>
        <AddLoanDialog propertyId={propertyId} />
      </div>
      <div className="space-y-2">
        {activeLoans.length === 0 && (
          <div className="text-xs text-muted-foreground">No active loans on file for this property.</div>
        )}
        {activeLoans.map((l) => (
          <LoanCard key={l.id} l={l} propertyId={propertyId} />
        ))}
      </div>
      {historicLoans.length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Loan history ({historicLoans.length})
          </button>
          {showHistory && (
            <div className="mt-2 space-y-2">
              {historicLoans.map((l) => (
                <LoanCard key={l.id} l={l} propertyId={propertyId} historic />
              ))}
            </div>
          )}
        </div>
      )}
      <DocumentsSection title="Documents" entries={documents} />
    </div>
  );
}

function PropertyAssetPage() {
  const { assetId } = Route.useParams();
  const { state, loading } = useStore();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>("overview");
  // Mirrors AppSidebar's hover-to-open/auto-hide behaviour: collapsed to icons until the pointer
  // enters, then expands, and collapses again on mouse-leave. No effect on touch/mobile, which
  // stays permanently expanded (there's no hover there).
  const isMobile = useIsMobile();
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const sidebarCollapsed = !isMobile && !sidebarHovered;
  // Within the expanded panel, a group (Finance/Property) reveals its items only while hovered —
  // same auto-open/auto-hide behaviour, one level down.
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const asset = state.assets.find((a) => a.id === assetId);
  // Looked up both directions (Asset.linkedPropertyId -> Property.id, and Property.assetId ->
  // Asset.id) rather than only the forward direction — the two are meant to be kept in sync by
  // the store's addProperty/updateProperty, but a property saved before that mirror existed, or
  // one whose mirror update silently no-op'd, can leave them pointing at each other only one way.
  const prop = asset
    ? state.properties.find((p) => p.id === asset.linkedPropertyId || p.assetId === asset.id)
    : undefined;

  // On first paint (SSR, or the moment before the client's initial Supabase fetch resolves),
  // state.assets/state.properties are still empty — without this check every property page
  // would flash "This page is for property assets only" before its own data ever loaded.
  if (loading && (!asset || !prop)) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link
          to="/assets"
          className="inline-flex items-center gap-1 text-sm text-primary underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Assets
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!asset || asset.assetType !== "Property" || !prop) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link
          to="/assets"
          className="inline-flex items-center gap-1 text-sm text-primary underline"
        >
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
  const propertyLoans = state.loans.filter((l) => l.propertyId === prop.id);
  const tenants = state.tenants.filter((t) => t.propertyId === prop.id);
  const tenantIds = new Set(tenants.map((t) => t.id));
  const expenses = state.expenses.filter((e) => e.propertyId === prop.id);
  const depreciationItems = state.depreciationItems.filter((d) => d.assetId === asset.id);
  const propertyLedger = state.ledger.filter((e) => tenantIds.has(e.tenantId));
  const propertyBills = state.bills.filter((b) => b.propertyId === prop.id);
  const propertyInsurancePolicies = state.insurancePolicies.filter(
    (ip) => ip.propertyId === prop.id,
  );
  const propertyBuffers = state.buffers.filter(
    (b) => b.scopeType === "Portfolio" || (b.scopeType === "Asset" && b.scopeId === prop.assetId),
  );
  const propertyAiProposals = state.aiProposals.filter((p) => p.propertyId === prop.id);

  const groups: { group: string | null; items: typeof NAV }[] = [];
  for (const item of NAV) {
    const key = item.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.group === key) last.items.push(item);
    else groups.push({ group: key, items: [item] });
  }

  return (
    <div className="flex min-h-[calc(100vh-1px)] flex-col sm:flex-row">
      <div
        className={`shrink-0 border-b p-3 sm:border-b-0 sm:border-r sm:p-4 ${sidebarCollapsed ? "sm:w-14" : "w-full sm:w-56"}`}
        onMouseEnter={() => !isMobile && setSidebarHovered(true)}
        onMouseLeave={() => {
          if (!isMobile) {
            setSidebarHovered(false);
            setHoveredGroup(null);
          }
        }}
      >
        <div className="mb-3 flex items-center gap-1">
          <Link
            to="/assets"
            title={sidebarCollapsed ? "All assets" : undefined}
            className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${sidebarCollapsed ? "justify-center" : ""}`}
          >
            <ArrowLeft className="h-3 w-3" /> {!sidebarCollapsed && "All assets"}
          </Link>
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
                  if (keptProperty) setSection("overview");
                  else void navigate({ to: "/assets" });
                }}
              />
            </div>
          </div>
        )}
        <nav className="space-y-3">
          {groups.map((g, i) => {
            const collapsed = g.group ? hoveredGroup !== g.group : false;
            return (
              <div
                key={i}
                onMouseEnter={() => g.group && setHoveredGroup(g.group)}
                onMouseLeave={() => g.group && setHoveredGroup((prev) => (prev === g.group ? null : prev))}
              >
                {g.group && !sidebarCollapsed ? (
                  <div className="mb-1 flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {collapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
                    {g.group}
                  </div>
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
                          section === item.section
                            ? "bg-primary/10 font-medium text-primary"
                            : "hover:bg-muted"
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
        {section === "overview" && (
          <OverviewSection
            scopeLabel={prop.alias || prop.address}
            properties={[prop]}
            loans={propertyLoans}
            expenses={expenses}
            ledger={propertyLedger}
            bills={propertyBills}
            insurancePolicies={propertyInsurancePolicies}
            buffers={propertyBuffers}
            valuationSnapshots={state.valuationSnapshots}
            loanBalanceSnapshots={state.loanBalanceSnapshots}
            aiProposals={propertyAiProposals}
            tenants={tenants}
            assets={state.assets}
            entities={state.entities}
          />
        )}
        {section === "summary" && (
          <PropertySummaryTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />
        )}
        {section === "performance" && (
          <PropertyPerformanceTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />
        )}
        {section === "purchase" && <PropertyPurchaseTab prop={prop} loan={loan} />}
        {section === "transactions" && <LedgerTab propertyId={prop.id} />}
        {section === "bills" && <PropertyBillsTab propertyId={prop.id} />}
        {section === "loans" && <PropertyLoansTab propertyId={prop.id} />}
        {section === "costbase" && (
          <PropertyCostBaseTab
            prop={prop}
            expenses={expenses}
            depreciationItems={depreciationItems}
          />
        )}
        {section === "depreciation" && <DepreciationTab assetId={asset.id} />}
        {section === "currentFigures" && (
          <PropertyCurrentFiguresTab prop={prop} tenants={tenants} />
        )}
        {section === "pnl" && (
          <PropertyPnLTab prop={prop} loan={loan} tenants={tenants} expenses={expenses} />
        )}
        {section === "forecasts" && (
          <PropertyForecastsTab prop={prop} loan={loan} tenants={tenants} />
        )}
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
