import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OverviewSection } from "@/components/OverviewSection";
import { fmtCurrency } from "@/lib/calculations";
import {
  ArrowLeft,
  LayoutDashboard,
  Building2,
  Receipt,
  FileText,
  Users,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Wallet,
  FileUp,
} from "lucide-react";
import { usePersistedToggle } from "@/lib/hooks";
import { LedgerTab } from "@/routes/transactions";
import { BillsBoard } from "@/components/BillsBoard";
import { AddBillDialog } from "@/components/AddBillDialog";
import { EntityDialog } from "@/components/EntityDialog";
import { AddBankAccountDialog } from "@/components/AddBankAccountDialog";
import { AddLoanDialog } from "@/components/AddLoanDialog";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import { LoanStatementHistory } from "@/components/LoanStatementHistory";
import { toast } from "sonner";

export const Route = createFileRoute("/entities_/$entityId")({
  head: () => ({
    meta: [{ title: "Entity — Landlord OS" }],
  }),
  component: EntityDetailPage,
});

type Section = "overview" | "transactions" | "bills" | "bankAccounts" | "details";

const NAV: {
  section: Section;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
}[] = [
  { section: "overview", label: "Overview", icon: LayoutDashboard },
  { section: "transactions", label: "Transactions", icon: Receipt, group: "Finance" },
  { section: "bills", label: "Bills", icon: FileText, group: "Finance" },
  { section: "bankAccounts", label: "Bank Accounts", icon: Wallet, group: "Finance" },
  { section: "details", label: "Entity Details", icon: Building2 },
];

function EntityDetailPage() {
  const { entityId } = Route.useParams();
  const { state, loading, deleteEntity } = useStore();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>("overview");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, toggleSidebar] = usePersistedToggle("entitySidebarCollapsed");
  const toggleGroup = (group: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const entity = state.entities.find((e) => e.id === entityId);

  if (loading && !entity) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link
          to="/entities"
          className="inline-flex items-center gap-1 text-sm text-primary underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Entities
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link
          to="/entities"
          className="inline-flex items-center gap-1 text-sm text-primary underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Entities
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Entity not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const properties = state.properties.filter((p) => p.entityId === entity.id);
  const propertyIds = properties.map((p) => p.id);

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
      >
        <div className="mb-3 flex items-center justify-between gap-1">
          {!sidebarCollapsed && (
            <Link
              to="/entities"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> All entities
            </Link>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        {!sidebarCollapsed && (
          <div className="mb-3 flex items-start justify-between gap-1">
            <div className="min-w-0">
              <div className="truncate font-semibold leading-tight">{entity.name}</div>
              <div className="text-xs text-muted-foreground">{entity.type}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <EntityDialog entity={entity}>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0">
                  <Pencil className="h-3 w-3" />
                </Button>
              </EntityDialog>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => {
                  if (
                    confirm(
                      properties.length > 0
                        ? `Delete "${entity.name}"? ${properties.length} propert${properties.length === 1 ? "y" : "ies"} linked to it will become unassigned.`
                        : `Delete "${entity.name}"?`,
                    )
                  ) {
                    deleteEntity(entity.id);
                    toast.success("Entity deleted");
                    void navigate({ to: "/entities" });
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
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
                    {collapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
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
      </div>

      <div className="min-w-0 flex-1 p-4 sm:p-6">
        {section === "overview" && <EntityOverviewTab entity={entity} properties={properties} />}
        {section === "transactions" && <LedgerTab propertyIds={propertyIds} />}
        {section === "bills" && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Bills across every property held under {entity.name}.
              </div>
              <AddBillDialog />
            </div>
            <BillsBoard propertyIds={propertyIds} />
          </div>
        )}
        {section === "bankAccounts" && (
          <EntityBankAccountsTab entity={entity} propertyIds={propertyIds} />
        )}
        {section === "details" && <EntityDetailsTab entity={entity} />}
      </div>
    </div>
  );
}

function EntityOverviewTab({
  entity,
  properties,
}: {
  entity: import("@/lib/types").Entity;
  properties: import("@/lib/types").Property[];
}) {
  const { state } = useStore();
  const propertyIds = properties.map((p) => p.id);
  const propertyIdSet = new Set(propertyIds);
  const tenants = state.tenants.filter((t) => propertyIdSet.has(t.propertyId));
  const tenantIds = new Set(tenants.map((t) => t.id));
  const loans = state.loans.filter((l) => propertyIdSet.has(l.propertyId));
  const expenses = state.expenses.filter((e) => e.propertyId && propertyIdSet.has(e.propertyId));
  const ledger = state.ledger.filter((e) => tenantIds.has(e.tenantId));
  const bills = state.bills.filter((b) => b.propertyId && propertyIdSet.has(b.propertyId));
  const insurancePolicies = state.insurancePolicies.filter((ip) =>
    propertyIdSet.has(ip.propertyId),
  );
  const buffers = state.buffers.filter(
    (b) =>
      b.scopeType === "Portfolio" ||
      (b.scopeType === "Entity" && b.scopeId === entity.id) ||
      (b.scopeType === "Asset" && properties.some((p) => p.assetId === b.scopeId)),
  );
  const aiProposals = state.aiProposals.filter(
    (p) => p.propertyId && propertyIdSet.has(p.propertyId),
  );

  return (
    <div className="space-y-6">
      <OverviewSection
        scopeLabel={entity.name}
        properties={properties}
        loans={loans}
        expenses={expenses}
        ledger={ledger}
        bills={bills}
        insurancePolicies={insurancePolicies}
        buffers={buffers}
        valuationSnapshots={state.valuationSnapshots}
        loanBalanceSnapshots={state.loanBalanceSnapshots}
        aiProposals={aiProposals}
        tenants={tenants}
        headerRight={<Badge variant="secondary">{entity.type}</Badge>}
      />
      {entity.owners.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          {entity.owners.map((o) => `${o.name} ${o.percent}%`).join(" · ")}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Properties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {properties.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <Building2 className="mx-auto mb-2 h-6 w-6" />
              No properties assigned to this entity yet — assign one from Assets.
            </div>
          )}
          {properties.map((p) => {
            const propLoans = state.loans.filter((l) => l.propertyId === p.id);
            const propDebt = propLoans.reduce((s, l) => s + l.totalBalance, 0);
            return (
              <Link
                key={p.id}
                to="/assets/$assetId"
                params={{ assetId: p.assetId ?? p.id }}
                className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.alias || p.address}</div>
                  {p.alias && (
                    <div className="truncate text-xs text-muted-foreground">{p.address}</div>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <div>{fmtCurrency(p.currentValue || 0)}</div>
                  <div>Debt {fmtCurrency(propDebt)}</div>
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function EntityBankAccountsTab({
  entity,
  propertyIds,
}: {
  entity: import("@/lib/types").Entity;
  propertyIds: string[];
}) {
  const { state } = useStore();
  const accounts = state.bankAccounts.filter((a) => a.entityId === entity.id);
  const propertyIdSet = new Set(propertyIds);
  const loans = state.loans.filter((l) => propertyIdSet.has(l.propertyId));
  const propertyName = (propertyId: string) => {
    const p = state.properties.find((pr) => pr.id === propertyId);
    return p ? p.alias || p.address : "Unknown property";
  };

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Cash accounts</div>
          <AddBankAccountDialog entityId={entity.id} />
        </div>
        <div className="space-y-2">
          {accounts.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No cash accounts on file for {entity.name}.
            </div>
          )}
          {accounts.map((a) => (
            <div key={a.id} className="rounded border p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{a.accountName}</div>
                  <div className="text-muted-foreground">
                    {a.institution || "—"} · {a.accountType ?? "Transaction"}
                  </div>
                </div>
                <AddBankAccountDialog
                  account={a}
                  entityId={entity.id}
                  trigger={
                    <Button size="icon" variant="ghost" className="h-6 w-6">
                      <Pencil className="h-3 w-3" />
                    </Button>
                  }
                />
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                <span>Balance: {fmtCurrency(a.currentBalance)}</span>
                <span>BSB: {a.bsb || "—"}</span>
                <span>Account: {a.accountNumber || "—"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Loan accounts</div>
          <AddLoanDialog />
        </div>
        <div className="space-y-2">
          {loans.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No loans on file for properties under {entity.name}.
            </div>
          )}
          {loans.map((l) => (
            <div key={l.id} className="rounded border p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{l.bankName}</div>
                  <div className="text-muted-foreground">{propertyName(l.propertyId)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <UploadDocumentDialog
                    loanId={l.id}
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        title="Upload statement"
                      >
                        <FileUp className="h-3 w-3" />
                      </Button>
                    }
                  />
                  <AddLoanDialog
                    loan={l}
                    propertyId={l.propertyId}
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
              <div className="mt-2">
                <LoanStatementHistory loanId={l.id} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EntityDetailsTab({ entity }: { entity: import("@/lib/types").Entity }) {
  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Entity Details</h2>
        <EntityDialog entity={entity}>
          <Button size="sm" variant="outline" className="gap-1">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        </EntityDialog>
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <div className="text-xs text-muted-foreground">Name</div>
            <div className="font-medium">{entity.name}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Type</div>
            <div className="font-medium">{entity.type}</div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Owners</div>
            {entity.owners.length === 0 && (
              <div className="text-muted-foreground">No owners on file.</div>
            )}
            <div className="space-y-1">
              {entity.owners.map((o, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded bg-muted px-2 py-1"
                >
                  <span>{o.name}</span>
                  <span className="text-muted-foreground">{o.percent}%</span>
                </div>
              ))}
            </div>
          </div>
          {entity.notes && (
            <div>
              <div className="text-xs text-muted-foreground">Notes</div>
              <div className="whitespace-pre-wrap">{entity.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
