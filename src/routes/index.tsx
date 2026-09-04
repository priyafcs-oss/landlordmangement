import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  daysUntil,
  todayISO,
  inspectionDueStatus,
  propertyInspectionCadenceDays,
  fmtCurrency,
} from "@/lib/calculations";
import {
  AlertTriangle,
  ShieldCheck,
  ClipboardCheck,
  ArrowRight,
  Wrench,
  CalendarClock,
  Plus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AiProposalsSection } from "@/components/PropertyShared";
import { NeedsReviewBanner } from "@/components/NeedsReviewBanner";
import { WaterRebillBanner } from "@/components/WaterRebillBanner";
import { OverviewSection } from "@/components/OverviewSection";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Landlord OS" },
      {
        name: "description",
        content: "Portfolio wealth, cash flow and proactive compliance alerts.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { state } = useStore();
  const [entityScope, setEntityScope] = useState("__all__");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const scopedProperties =
    entityScope === "__all__"
      ? state.properties
      : state.properties.filter((p) => p.entityId === entityScope);
  const scopedPropertyIds = new Set(scopedProperties.map((p) => p.id));
  const scopedTenants = state.tenants.filter((t) => scopedPropertyIds.has(t.propertyId));
  const scopedTenantIds = new Set(scopedTenants.map((t) => t.id));
  const scopedLoans =
    entityScope === "__all__"
      ? state.loans
      : state.loans.filter((l) => scopedPropertyIds.has(l.propertyId));
  const scopedExpenses =
    entityScope === "__all__"
      ? state.expenses
      : state.expenses.filter((e) => e.propertyId && scopedPropertyIds.has(e.propertyId));
  const scopedLedger =
    entityScope === "__all__"
      ? state.ledger
      : state.ledger.filter((e) => scopedTenantIds.has(e.tenantId));
  const scopedBills = state.bills.filter(
    (b) => b.propertyId && scopedPropertyIds.has(b.propertyId),
  );
  const scopedInsurancePolicies = state.insurancePolicies.filter((ip) =>
    scopedPropertyIds.has(ip.propertyId),
  );
  const scopedBuffers = state.buffers.filter(
    (b) =>
      b.scopeType === "Portfolio" ||
      (entityScope !== "__all__" && b.scopeType === "Entity" && b.scopeId === entityScope) ||
      (b.scopeType === "Asset" && scopedProperties.some((p) => p.assetId === b.scopeId)),
  );
  const scopedAiProposals =
    entityScope === "__all__"
      ? state.aiProposals
      : state.aiProposals.filter((p) => p.propertyId && scopedPropertyIds.has(p.propertyId));
  // Every asset — property, gold, ETF — that has a status of Active and isn't a property (those
  // are already counted via scopedProperties' own currentValue) feeds the portfolio value figure.
  const extraAssetsValue = state.assets
    .filter((a) => a.status === "Active" && a.assetType !== "Property")
    .filter((a) => entityScope === "__all__" || a.ownerEntityId === entityScope)
    .reduce((s, a) => s + a.currentValue, 0);

  const leaseAlerts = state.tenants.filter((t) => {
    if (!scopedPropertyIds.has(t.propertyId)) return false;
    if (!t.leaseExpiry) return false;
    const d = daysUntil(t.leaseExpiry);
    return d >= 0 && d <= 60;
  });

  const warrantyAlerts = scopedExpenses.filter((e) => {
    if (!e.hasWarranty || !e.warrantyExpiry) return false;
    const d = daysUntil(e.warrantyExpiry);
    return d >= 0 && d <= 90;
  });

  const complianceAlerts = scopedProperties.filter(
    (p) => inspectionDueStatus(p.id, state.inspections, propertyInspectionCadenceDays(p)).overdue,
  );

  const pendingApprovals =
    state.aiProposals.filter((p) => p.status === "pending").length +
    state.expenses.filter((e) => e.status === "needs_review").length +
    state.bills.filter((b) => b.tenantRebillStatus === "pending").length;

  const selectedEntityName = state.entities.find((e) => e.id === entityScope)?.name;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <OverviewSection
        scopeLabel={selectedEntityName ?? "Portfolio"}
        properties={scopedProperties}
        loans={scopedLoans}
        expenses={scopedExpenses}
        ledger={scopedLedger}
        bills={scopedBills}
        insurancePolicies={scopedInsurancePolicies}
        buffers={scopedBuffers}
        valuationSnapshots={state.valuationSnapshots}
        loanBalanceSnapshots={state.loanBalanceSnapshots}
        aiProposals={scopedAiProposals}
        tenants={scopedTenants}
        extraAssetsValue={extraAssetsValue}
        headerRight={
          state.entities.length > 0 ? (
            <Select value={entityScope} onValueChange={setEntityScope}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All entities</SelectItem>
                {state.entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {pendingApprovals > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium">Needs your approval ({pendingApprovals})</div>
          <AiProposalsSection />
          <NeedsReviewBanner />
          <WaterRebillBanner />
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setDetailsOpen((o) => !o)}
      >
        {detailsOpen ? "Hide" : "Show"} lease, warranty & compliance alerts{" "}
        {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>

      {detailsOpen && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Lease renewals (60 days)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {leaseAlerts.length === 0 && (
                  <div className="text-muted-foreground">No upcoming expiries.</div>
                )}
                {leaseAlerts.map((t) => {
                  const prop = state.properties.find((p) => p.id === t.propertyId);
                  return (
                    <div key={t.id} className="rounded-md border p-3">
                      <div className="font-medium">Lease expiring soon</div>
                      <div className="text-xs text-muted-foreground">
                        {t.name} at {prop?.address} — expires {t.leaseExpiry}
                      </div>
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="mt-2 h-7 gap-1 px-2 text-xs"
                      >
                        <Link to="/rental">
                          Draft notice <ArrowRight className="h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Asset warranties (90 days)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {warrantyAlerts.length === 0 && (
                  <div className="text-muted-foreground">No warranties expiring soon.</div>
                )}
                {warrantyAlerts.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <div className="font-medium">{e.itemName}</div>
                      <div className="text-xs text-muted-foreground">
                        Expires {e.warrantyExpiry}
                      </div>
                    </div>
                    <Badge variant="outline">{daysUntil(e.warrantyExpiry!)} days</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-blue-600" />
                Compliance: inspections
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {complianceAlerts.length === 0 && (
                <div className="text-muted-foreground">All properties inspected recently.</div>
              )}
              {complianceAlerts.map((p) => {
                const status = inspectionDueStatus(
                  p.id,
                  state.inspections,
                  propertyInspectionCadenceDays(p),
                );
                return (
                  <div key={p.id} className="rounded-md border p-3">
                    <div className="font-medium">{p.address}</div>
                    <div className="text-xs text-muted-foreground">
                      {status.last
                        ? `Last inspected ${status.last.date} — overdue`
                        : "No inspection on record"}
                    </div>
                  </div>
                );
              })}
              {complianceAlerts.length > 0 && (
                <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                  <Link to="/inspections">
                    Book inspections <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>

          <HousekeepingWidget />
        </div>
      )}

      <MaintenanceRequestsWidget />
    </div>
  );
}

/** Bills and loan EMIs falling due within the next 7 days. */
function HousekeepingWidget() {
  const { state, markBillPaid } = useStore();
  const dueBills = state.bills
    .filter((b) => b.status !== "Paid")
    .map((b) => ({ bill: b, days: daysUntil(b.dueDate) }))
    .filter((x) => x.days <= 7)
    .sort((a, b) => a.days - b.days);

  const today = new Date();
  const dueEmis = state.loans
    .filter((l) => l.dueDayOfMonth && l.monthlyEmi > 0)
    .map((l) => {
      const day = Math.min(l.dueDayOfMonth!, 28);
      let due = new Date(today.getFullYear(), today.getMonth(), day);
      if (due < today) due = new Date(today.getFullYear(), today.getMonth() + 1, day);
      return {
        loan: l,
        days: daysUntil(due.toISOString().slice(0, 10)),
        date: due.toISOString().slice(0, 10),
      };
    })
    .filter((x) => x.days <= 7)
    .sort((a, b) => a.days - b.days);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-violet-600" />
          Housekeeping alerts — due within 7 days
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {dueBills.length === 0 && dueEmis.length === 0 && (
          <div className="text-muted-foreground">Nothing due in the next 7 days.</div>
        )}
        {dueBills.map(({ bill, days }) => {
          const prop = state.properties.find((p) => p.id === bill.propertyId);
          return (
            <div
              key={bill.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <div>
                <div className="font-medium">
                  {bill.billType} — {fmtCurrency(bill.amount)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {prop?.address} • due {bill.dueDate}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={days < 0 ? "destructive" : "outline"}>
                  {days < 0 ? `${Math.abs(days)} days overdue` : `${days} days`}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => markBillPaid(bill.id)}>
                  Mark paid
                </Button>
              </div>
            </div>
          );
        })}
        {dueEmis.map(({ loan, days, date }) => {
          const prop = state.properties.find((p) => p.id === loan.propertyId);
          return (
            <div
              key={loan.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <div>
                <div className="font-medium">
                  {loan.bankName} EMI — {fmtCurrency(loan.monthlyEmi)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {prop?.address} • due {date}
                  {loan.isDirectDebit ? " • direct debit" : ""}
                </div>
              </div>
              <Badge variant="outline">{days} days</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Landlord-initiated maintenance entry (same table as the public tenant form). */
function LogMaintenanceDialog() {
  const { state, addMaintenanceRequest } = useStore();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [category, setCategory] = useState("Other");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<"Low" | "Medium" | "High">("Medium");

  const save = async () => {
    if (!propertyId) return toast.error("Select a property");
    if (!description.trim()) return toast.error("Describe the issue");
    const prop = state.properties.find((p) => p.id === propertyId);
    await addMaintenanceRequest({
      propertyId,
      propertyAddressTyped: prop?.address ?? "",
      category,
      description: description.trim(),
      urgency,
      photos: [],
      contactName: state.landlordProfile.fullName || "Landlord",
      contactPhone: state.landlordProfile.phone || "",
      contactEmail: state.landlordProfile.email || "",
      source: "landlord",
    });
    setOpen(false);
    setDescription("");
    toast.success("Maintenance job logged");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
          <Plus className="h-3 w-3" /> Log maintenance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a maintenance job</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger>
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              {state.properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {[
                "Plumbing",
                "Electrical",
                "Heating / Cooling",
                "Appliance",
                "Structural",
                "Pest",
                "Other",
              ].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={urgency} onValueChange={(v) => setUrgency(v as "Low" | "Medium" | "High")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Low">Low</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="High">High</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Describe the issue"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={save}>Save job</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaintenanceRequestsWidget() {
  const { state, updateMaintenanceRequest, addExpense } = useStore();
  const pending = state.maintenanceRequests.filter((r) => r.status === "Pending");
  const convert = (id: string) => {
    const req = state.maintenanceRequests.find((r) => r.id === id);
    if (!req) return;
    const propertyId = req.propertyId ?? state.properties[0]?.id;
    if (!propertyId) return toast.error("Add a property first before converting requests");
    addExpense({
      itemName: `${req.category}: ${req.description.slice(0, 60)}`,
      cost: 0,
      date: todayISO(),
      propertyId,
      category: "Repairs & Maintenance",
      taxCategory: "Immediate Deduction",
      hasWarranty: false,
      rechargeToTenant: false,
      status: "approved",
      source: "manual",
    });
    updateMaintenanceRequest(id, { status: "Converted" });
    toast.success("Converted to expense — update cost on the Expenses tab");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-orange-600" />
          Maintenance requests ({pending.length})
          <span className="ml-auto flex items-center gap-2">
            <LogMaintenanceDialog />
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Link to="/maintenance">Open public form</Link>
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {pending.length === 0 && (
          <div className="text-muted-foreground">
            No pending requests. Share your /maintenance link with tenants.
          </div>
        )}
        {pending.map((r) => {
          const prop = state.properties.find((p) => p.id === r.propertyId);
          const urgencyBadge =
            r.urgency === "High" ? "destructive" : r.urgency === "Medium" ? "default" : "secondary";
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{r.category}</Badge>
                  <Badge variant={urgencyBadge}>{r.urgency}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {prop?.address ?? `Typed: ${r.propertyAddressTyped}`}
                </div>
                <div className="mt-1 text-xs">
                  From <b>{r.contactName}</b> • {r.contactPhone} • {r.contactEmail}
                </div>
                <div className="mt-1">{r.description}</div>
                {r.photos && r.photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.photos.map((p, i) => (
                      <img
                        key={i}
                        src={p.data}
                        alt={p.name}
                        className="h-14 w-14 rounded object-cover"
                      />
                    ))}
                  </div>
                )}
                {r.video && <video src={r.video.data} controls className="mt-2 max-h-40 rounded" />}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => convert(r.id)}>
                  Convert to Expense
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => updateMaintenanceRequest(r.id, { status: "Dismissed" })}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
