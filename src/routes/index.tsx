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
  buildTenantLedger,
  buildActivityFeed,
  fmtCurrency,
  daysUntil,
  todayISO,
  inspectionDueStatus,
  propertyInspectionCadenceDays,
} from "@/lib/calculations";
import {
  AlertTriangle,
  TrendingUp,
  ShieldCheck,
  ClipboardCheck,
  Wallet,
  Landmark,
  ArrowRight,
  Wrench,
  CalendarClock,
  Plus,
  ChevronDown,
  ChevronUp,
  Activity,
} from "lucide-react";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AiProposalsSection } from "@/components/PropertyShared";
import { NeedsReviewBanner } from "@/components/NeedsReviewBanner";
import { WaterRebillBanner } from "@/components/WaterRebillBanner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Landlord OS" },
      { name: "description", content: "Portfolio wealth, cash flow and proactive compliance alerts." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { state } = useStore();
  const [entityScope, setEntityScope] = useState("__all__");
  const [chartMonths, setChartMonths] = useState<6 | 12>(6);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const scopedProperties =
    entityScope === "__all__" ? state.properties : state.properties.filter((p) => p.entityId === entityScope);
  const scopedPropertyIds = new Set(scopedProperties.map((p) => p.id));
  const scopedTenantIds = new Set(
    state.tenants.filter((t) => scopedPropertyIds.has(t.propertyId)).map((t) => t.id),
  );
  const scopedLoans = entityScope === "__all__" ? state.loans : state.loans.filter((l) => scopedPropertyIds.has(l.propertyId));
  const scopedExpenses =
    entityScope === "__all__" ? state.expenses : state.expenses.filter((e) => e.propertyId && scopedPropertyIds.has(e.propertyId));
  const scopedLedger = entityScope === "__all__" ? state.ledger : state.ledger.filter((e) => scopedTenantIds.has(e.tenantId));
  // Every asset — property, gold, ETF — that has a status of Active feeds the wealth cards below;
  // Gold/ETF don't yet have an owner entity assigned, so they only show up under "All entities".
  const scopedAssets = state.assets
    .filter((a) => a.status === "Active")
    .filter((a) => entityScope === "__all__" || a.ownerEntityId === entityScope);

  const totalValue = scopedAssets.reduce((s, a) => s + a.currentValue, 0);
  const totalDebt = scopedLoans.reduce((s, l) => s + l.totalBalance, 0);
  const totalOffset = scopedLoans.reduce((s, l) => s + (l.offsetBalance || 0), 0);
  const equity = totalValue - totalDebt;
  const lvrPercent = totalValue > 0 ? Math.min(100, Math.round((totalDebt / totalValue) * 100)) : 0;

  const rentReceived = scopedLedger.reduce((s, e) => s + (e.type === "Rent Payment" ? e.credit : 0), 0);
  const invoicesReceived = scopedLedger.reduce(
    (s, e) => s + ((e.type === "Water Invoice" || e.type === "Maintenance Charge") ? e.credit : 0),
    0,
  );
  const totalEmis = scopedLoans.reduce((s, l) => s + l.monthlyEmi, 0);
  const totalExpenses = scopedExpenses.reduce((s, e) => s + e.cost, 0);
  const netCashFlow = rentReceived + invoicesReceived - totalEmis - totalExpenses;

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

  const dueSoonCount = state.bills.filter(
    (b) => !!b.propertyId && scopedPropertyIds.has(b.propertyId) && b.status !== "Paid" && daysUntil(b.dueDate) <= 7,
  ).length;
  const worstBuffer = state.buffers
    .map((b) => {
      const target = b.targetAmount;
      const pct = target && target > 0 ? (b.currentBalance / target) * 100 : undefined;
      return { buffer: b, pct };
    })
    .filter((x) => x.pct !== undefined)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0];
  const bufferAlert = worstBuffer && (worstBuffer.pct ?? 100) < 100 ? 1 : 0;
  const attentionCount = leaseAlerts.length + warrantyAlerts.length + complianceAlerts.length + dueSoonCount + bufferAlert;
  const pendingApprovals =
    state.aiProposals.filter((p) => p.status === "pending").length +
    state.expenses.filter((e) => e.status === "needs_review").length +
    state.bills.filter((b) => b.tenantRebillStatus === "pending").length;

  // Chart data: real income vs expenses per month, from the ledger/expenses actually on file.
  const months: { name: string; income: number; expenses: number; cashflow: number }[] = [];
  for (let i = chartMonths - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    const income = scopedLedger.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.credit, 0);
    const exp = scopedExpenses.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.cost, 0);
    months.push({
      name: d.toLocaleString("en-AU", { month: "short", year: chartMonths === 12 ? "2-digit" : undefined }),
      income,
      expenses: exp,
      cashflow: income - exp - totalEmis,
    });
  }

  // Value/loan trend: for each month, the latest snapshot at-or-before that month's end, summed
  // across scoped assets/loans. Months before any snapshot exists simply have no data point yet —
  // no synthetic interpolation.
  const latestAtOrBefore = <T extends { date: string }>(rows: T[], dateISO: string): T | undefined =>
    rows.filter((r) => r.date <= dateISO).sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  const valueTrend: { name: string; value: number }[] = [];
  const loanTrend: { name: string; balance: number }[] = [];
  for (let i = chartMonths - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const name = d.toLocaleString("en-AU", { month: "short", year: chartMonths === 12 ? "2-digit" : undefined });
    const value = scopedAssets.reduce((s, a) => {
      const snap = latestAtOrBefore(state.valuationSnapshots.filter((v) => v.assetId === a.id), monthEnd);
      return s + (snap?.value ?? 0);
    }, 0);
    const balance = scopedLoans.reduce((s, l) => {
      const snap = latestAtOrBefore(state.loanBalanceSnapshots.filter((v) => v.loanId === l.id), monthEnd);
      return s + (snap?.balance ?? 0);
    }, 0);
    valueTrend.push({ name, value });
    loanTrend.push({ name, balance });
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio Dashboard</h1>
          <p className="text-sm text-muted-foreground">Wealth, cash flow, and proactive compliance signals.</p>
        </div>
        {state.entities.length > 0 && (
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
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div className="text-sm">
            {netCashFlow >= 0 ? "Cashflow's positive." : "Cashflow's negative."}{" "}
            {attentionCount === 0
              ? "Nothing needs your attention right now."
              : `${attentionCount} thing${attentionCount === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} your attention.`}
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setDetailsOpen((o) => !o)}>
            Details {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </CardContent>
      </Card>

      {pendingApprovals > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium">Needs your approval ({pendingApprovals})</div>
          <AiProposalsSection />
          <NeedsReviewBanner />
          <WaterRebillBanner />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={<Landmark className="h-4 w-4" />} label="Portfolio Value" value={fmtCurrency(totalValue)} />
        <MetricCard icon={<Wallet className="h-4 w-4" />} label="Total Debt" value={fmtCurrency(totalDebt)} />
        <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Equity" value={fmtCurrency(equity)} highlight />
        <MetricCard
          icon={<Wallet className="h-4 w-4" />}
          label="Net Cash Flow"
          value={fmtCurrency(netCashFlow)}
          highlight={netCashFlow >= 0}
          negative={netCashFlow < 0}
        />
      </div>

      {totalValue > 0 && (
        <div className="rounded-md border p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>Debt {lvrPercent}%</span>
            <span>Equity {100 - lvrPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-200">
            <div className="h-full bg-amber-500" style={{ width: `${lvrPercent}%` }} />
          </div>
          {totalOffset > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Offset balance: <span className="font-medium text-foreground">{fmtCurrency(totalOffset)}</span> — already
              reducing the interest on the debt above.
            </div>
          )}
          {worstBuffer && (
            <div className="mt-2 text-xs text-muted-foreground">
              Lowest buffer — {worstBuffer.buffer.label}:{" "}
              <span className={`font-medium ${(worstBuffer.pct ?? 100) < 100 ? "text-amber-600" : "text-foreground"}`}>
                {Math.round(worstBuffer.pct ?? 0)}% covered
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Income vs expenses</CardTitle>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={chartMonths === 6 ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setChartMonths(6)}
              >
                6M
              </Button>
              <Button
                size="sm"
                variant={chartMonths === 12 ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setChartMonths(12)}
              >
                12M
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-[240px] w-full"
              config={{
                income: { label: "Income", color: "hsl(var(--primary))" },
                expenses: { label: "Expenses", color: "hsl(var(--destructive))" },
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={months}>
                  <defs>
                    <linearGradient id="c1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-income)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-income)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="c2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-expenses)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--color-expenses)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="income" stroke="var(--color-income)" fill="url(#c1)" />
                  <Area type="monotone" dataKey="expenses" stroke="var(--color-expenses)" fill="url(#c2)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <ActivityFeedCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Portfolio value trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer className="h-[200px] w-full" config={{ value: { label: "Value", color: "hsl(var(--primary))" } }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={valueTrend}>
                  <defs>
                    <linearGradient id="c3" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="value" stroke="var(--color-value)" fill="url(#c3)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Loan balance trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer className="h-[200px] w-full" config={{ balance: { label: "Balance", color: "hsl(var(--destructive))" } }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={loanTrend}>
                  <defs>
                    <linearGradient id="c4" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-balance)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-balance)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="balance" stroke="var(--color-balance)" fill="url(#c4)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

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
                {leaseAlerts.length === 0 && <div className="text-muted-foreground">No upcoming expiries.</div>}
                {leaseAlerts.map((t) => {
                  const prop = state.properties.find((p) => p.id === t.propertyId);
                  return (
                    <div key={t.id} className="rounded-md border p-3">
                      <div className="font-medium">Lease expiring soon</div>
                      <div className="text-xs text-muted-foreground">
                        {t.name} at {prop?.address} — expires {t.leaseExpiry}
                      </div>
                      <Button asChild variant="ghost" size="sm" className="mt-2 h-7 gap-1 px-2 text-xs">
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
                {warrantyAlerts.length === 0 && <div className="text-muted-foreground">No warranties expiring soon.</div>}
                {warrantyAlerts.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="font-medium">{e.itemName}</div>
                      <div className="text-xs text-muted-foreground">Expires {e.warrantyExpiry}</div>
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
              {complianceAlerts.length === 0 && <div className="text-muted-foreground">All properties inspected recently.</div>}
              {complianceAlerts.map((p) => {
                const status = inspectionDueStatus(p.id, state.inspections, propertyInspectionCadenceDays(p));
                return (
                  <div key={p.id} className="rounded-md border p-3">
                    <div className="font-medium">{p.address}</div>
                    <div className="text-xs text-muted-foreground">
                      {status.last ? `Last inspected ${status.last.date} — overdue` : "No inspection on record"}
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

/** Recent automated activity — bills matched, statements processed, documents filed. */
function ActivityFeedCard() {
  const { state } = useStore();
  const items = buildActivityFeed(state);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {items.length === 0 && (
          <div className="text-muted-foreground">
            Nothing automated yet — processed bills and rent statements will show up here.
          </div>
        )}
        {items.map((item) => {
          const days = Math.abs(daysUntil(item.date));
          const rel = days === 0 ? "Today" : `${days}d ago`;
          return (
            <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1">{item.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                {item.amount !== undefined && (
                  <span className={item.amount < 0 ? "text-destructive" : "text-emerald-600"}>
                    {item.amount < 0 ? "−" : "+"}
                    {fmtCurrency(Math.abs(item.amount))}
                  </span>
                )}
                <span className="text-muted-foreground">{rel}</span>
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
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
      return { loan: l, days: daysUntil(due.toISOString().slice(0, 10)), date: due.toISOString().slice(0, 10) };
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
            <div key={bill.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
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
            <div key={loan.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
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
              {["Plumbing", "Electrical", "Heating / Cooling", "Appliance", "Structural", "Pest", "Other"].map((c) => (
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
          <div className="text-muted-foreground">No pending requests. Share your /maintenance link with tenants.</div>
        )}
        {pending.map((r) => {
          const prop = state.properties.find((p) => p.id === r.propertyId);
          const urgencyBadge =
            r.urgency === "High"
              ? "destructive"
              : r.urgency === "Medium"
                ? "default"
                : "secondary";
          return (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded border p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{r.category}</Badge>
                  <Badge variant={urgencyBadge}>{r.urgency}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span>
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
                      <img key={i} src={p.data} alt={p.name} className="h-14 w-14 rounded object-cover" />
                    ))}
                  </div>
                )}
                {r.video && (
                  <video src={r.video.data} controls className="mt-2 max-h-40 rounded" />
                )}
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

function MetricCard({
  icon,
  label,
  value,
  highlight,
  negative,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div
          className={
            "mt-2 text-2xl font-semibold tracking-tight " +
            (negative ? "text-destructive" : highlight ? "text-emerald-600" : "")
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
