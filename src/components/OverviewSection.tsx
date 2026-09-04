import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Landmark,
  Wallet,
  TrendingUp,
  Activity as ActivityIcon,
  ShieldCheck,
} from "lucide-react";
import { buildActivityFeed, daysUntil, fmtCurrency } from "@/lib/calculations";
import {
  computeOverviewMetrics,
  computeCashflowSeries,
  computeBufferStatus,
  computeInsuranceAlerts,
  computeRentHeatmap,
  computeValueDebtTrend,
} from "@/lib/overview";
import type {
  Property,
  Loan,
  Expense,
  LedgerEntry,
  PropertyBill,
  CashBuffer,
  InsurancePolicy,
  ValuationSnapshot,
  LoanBalanceSnapshot,
  AiIntakeProposal,
  Tenant,
} from "@/lib/types";

export interface OverviewSectionProps {
  scopeLabel: string;
  greeting?: string;
  properties: Property[];
  loans: Loan[];
  expenses: Expense[];
  ledger: LedgerEntry[];
  bills: PropertyBill[];
  insurancePolicies: InsurancePolicy[];
  buffers: CashBuffer[];
  valuationSnapshots: ValuationSnapshot[];
  loanBalanceSnapshots: LoanBalanceSnapshot[];
  aiProposals: AiIntakeProposal[];
  tenants: Tenant[];
  extraAssetsValue?: number;
  headerRight?: ReactNode;
}

const CASHFLOW_CHART_CONFIG: ChartConfig = {
  income: { label: "Income", color: "var(--primary)" },
  expenses: { label: "Expenses", color: "var(--destructive)" },
};

const VALUE_DEBT_CHART_CONFIG: ChartConfig = {
  value: { label: "Value", color: "var(--primary)" },
  debt: { label: "Debt", color: "var(--muted-foreground)" },
};

export function OverviewSection({
  scopeLabel,
  greeting,
  properties,
  loans,
  expenses,
  ledger,
  bills,
  insurancePolicies,
  buffers,
  valuationSnapshots,
  loanBalanceSnapshots,
  aiProposals,
  tenants,
  extraAssetsValue = 0,
  headerRight,
}: OverviewSectionProps) {
  const [cashflowMonths, setCashflowMonths] = useState<6 | 12>(6);
  const [valueDebtRange, setValueDebtRange] = useState<"12M" | "5Y" | "10Y">("12M");

  const metrics = computeOverviewMetrics(properties, loans, extraAssetsValue);
  const cashflow = computeCashflowSeries(ledger, expenses, loans, cashflowMonths);
  const bufferStatus = computeBufferStatus(buffers);
  const insuranceAlerts = computeInsuranceAlerts(properties, insurancePolicies);
  const heatmap = computeRentHeatmap(ledger);
  const valueDebtPoints = computeValueDebtTrend(
    properties,
    loans,
    valuationSnapshots,
    loanBalanceSnapshots,
    valueDebtRange,
  );

  const alerts: string[] = [...insuranceAlerts.map((a) => a.label)];
  if (cashflow.netPerMonth < 0) alerts.push("Cashflow was negative last month");
  if (metrics.lvrPercent >= 80) alerts.push(`LVR is high at ${metrics.lvrPercent}%`);
  if (bufferStatus.worstPct !== null && bufferStatus.worstPct < 100) {
    alerts.push(
      `${bufferStatus.worstLabel} buffer is only ${Math.round(bufferStatus.worstPct)}% covered`,
    );
  }

  const narrative = `${greeting ?? scopeLabel} equity is ${metrics.equity >= 0 ? "at" : "down to"} ${fmtCurrency(metrics.equity)}${
    metrics.totalDebt === 0 ? " with no debt" : ` against ${fmtCurrency(metrics.totalDebt)} of debt`
  }${alerts.length === 0 ? ", and nothing needs your attention right now." : `, but ${alerts.length} thing${alerts.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} attention.`}`;

  const activityItems = buildActivityFeed({ expenses, ledger, aiProposals, properties, tenants });
  const upcomingBills = bills
    .filter((b) => b.status !== "Paid")
    .map((b) => ({ bill: b, days: daysUntil(b.dueDate) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);

  const chartData = valueDebtPoints.map((p, i) => {
    const lastActualIndex = valueDebtPoints.reduce(
      (acc, pt, idx) => (!pt.projected ? idx : acc),
      -1,
    );
    const showEst = p.projected || i === lastActualIndex;
    return {
      name: p.name,
      value: p.projected ? undefined : p.value,
      debt: p.projected ? undefined : p.debt,
      valueEst: showEst ? p.value : undefined,
      debtEst: showEst ? p.debt : undefined,
    };
  });
  const hasProjection = valueDebtPoints.some((p) => p.projected);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{scopeLabel} — Overview</h1>
        {headerRight}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                {alerts.length === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                Status update
              </div>
              <div className="text-sm text-muted-foreground">{narrative}</div>
              {alerts.length > 0 && (
                <div className="space-y-1.5 border-t pt-2">
                  {alerts.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-0">
              <Tabs defaultValue="activity">
                <TabsList>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="bills">Upcoming bills</TabsTrigger>
                </TabsList>
                <TabsContent value="activity">
                  <div className="space-y-2 py-2 text-sm">
                    {activityItems.length === 0 && (
                      <div className="text-xs text-muted-foreground">
                        Nothing yet — activity shows up here as it happens.
                      </div>
                    )}
                    {activityItems.map((item) => {
                      const days = Math.abs(daysUntil(item.date));
                      const rel = days === 0 ? "Today" : `${days}d ago`;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0 flex-1">{item.label}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            {item.amount !== undefined && (
                              <span
                                className={
                                  item.amount < 0 ? "text-destructive" : "text-emerald-600"
                                }
                              >
                                {item.amount < 0 ? "−" : "+"}
                                {fmtCurrency(Math.abs(item.amount))}
                              </span>
                            )}
                            <span className="text-muted-foreground">{rel}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>
                <TabsContent value="bills">
                  <div className="space-y-2 py-2 text-sm">
                    {upcomingBills.length === 0 && (
                      <div className="text-xs text-muted-foreground">No unpaid bills on file.</div>
                    )}
                    {upcomingBills.map(({ bill, days }) => (
                      <div
                        key={bill.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {bill.billType} — {fmtCurrency(bill.amount)}
                        </span>
                        <Badge variant={days < 0 ? "destructive" : "outline"} className="shrink-0">
                          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardHeader>
            <CardContent />
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              icon={<Landmark className="h-4 w-4" />}
              label="Portfolio Value"
              value={fmtCurrency(metrics.totalValue)}
            />
            <MetricTile
              icon={<Wallet className="h-4 w-4" />}
              label="Total Debt"
              value={fmtCurrency(metrics.totalDebt)}
            />
            <MetricTile
              icon={<TrendingUp className="h-4 w-4" />}
              label="Equity"
              value={fmtCurrency(metrics.equity)}
              highlight
            />
            <MetricTile
              icon={<Wallet className="h-4 w-4" />}
              label="Cashflow / mo"
              value={`${cashflow.netPerMonth < 0 ? "−" : "+"}${fmtCurrency(Math.abs(cashflow.netPerMonth))}`}
              highlight={cashflow.netPerMonth >= 0}
              negative={cashflow.netPerMonth < 0}
            />
          </div>

          {metrics.totalValue > 0 && (
            <div className="rounded-md border p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>Debt {metrics.lvrPercent}%</span>
                <span>Equity {100 - metrics.lvrPercent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-200">
                <div className="h-full bg-amber-500" style={{ width: `${metrics.lvrPercent}%` }} />
              </div>
              {metrics.totalOffset > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Offset balance:{" "}
                  <span className="font-medium text-foreground">
                    {fmtCurrency(metrics.totalOffset)}
                  </span>{" "}
                  — already reducing the interest on the debt above.
                </div>
              )}
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Cashflow</CardTitle>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={cashflowMonths === 6 ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setCashflowMonths(6)}
                >
                  6M
                </Button>
                <Button
                  size="sm"
                  variant={cashflowMonths === 12 ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setCashflowMonths(12)}
                >
                  12M
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ChartContainer className="h-[200px] w-full" config={CASHFLOW_CHART_CONFIG}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cashflow.months}>
                    <defs>
                      <linearGradient id="ov-income" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-income)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--color-income)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ov-expenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-expenses)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-expenses)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="income"
                      stroke="var(--color-income)"
                      fill="url(#ov-income)"
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      stroke="var(--color-expenses)"
                      fill="url(#ov-expenses)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
              <div className="grid grid-cols-3 gap-2 border-t pt-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Net / mo</div>
                  <div
                    className={`font-medium ${cashflow.netPerMonth < 0 ? "text-destructive" : "text-emerald-600"}`}
                  >
                    {cashflow.netPerMonth < 0 ? "−" : "+"}
                    {fmtCurrency(Math.abs(cashflow.netPerMonth))}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Money in</div>
                  <div className="font-medium">{fmtCurrency(cashflow.moneyIn)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Money out</div>
                  <div className="font-medium">{fmtCurrency(cashflow.moneyOut)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Projected</div>
                  <div
                    className={`font-medium ${cashflow.projected < 0 ? "text-destructive" : "text-emerald-600"}`}
                  >
                    {cashflow.projected < 0 ? "−" : "+"}
                    {fmtCurrency(Math.abs(cashflow.projected))}
                  </div>
                </div>
              </div>
              {buffers.length > 0 && (
                <div className="border-t pt-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <ShieldCheck className="h-3 w-3" /> Cash buffer
                    </span>
                    <span
                      className={bufferStatus.fullyCovered ? "text-emerald-600" : "text-amber-600"}
                    >
                      {bufferStatus.fullyCovered
                        ? "Fully covered"
                        : `${Math.round(bufferStatus.worstPct ?? 0)}% covered`}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${bufferStatus.fullyCovered ? "bg-emerald-500" : "bg-amber-500"}`}
                      style={{ width: `${Math.min(100, bufferStatus.worstPct ?? 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Value vs debt</CardTitle>
                {hasProjection && (
                  <div className="text-xs text-muted-foreground">Dashed years are estimated</div>
                )}
              </div>
              <div className="flex gap-1">
                {(["12M", "5Y", "10Y"] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={valueDebtRange === r ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setValueDebtRange(r)}
                  >
                    {r}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <ChartContainer className="h-[220px] w-full" config={VALUE_DEBT_CHART_CONFIG}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <defs>
                      <linearGradient id="ov-value" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--color-value)"
                      fill="url(#ov-value)"
                      connectNulls={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="valueEst"
                      stroke="var(--color-value)"
                      strokeDasharray="4 4"
                      fill="url(#ov-value)"
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="debt"
                      stroke="var(--color-debt)"
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="debtEst"
                      stroke="var(--color-debt)"
                      strokeDasharray="4 4"
                      dot={false}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      <RentReceivedHeatmap cells={heatmap} />
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  highlight,
  negative,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div
          className={
            "mt-2 text-xl font-semibold tracking-tight " +
            (negative ? "text-destructive" : highlight ? "text-emerald-600" : "")
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function RentReceivedHeatmap({
  cells,
}: {
  cells: { year: number; month: number; amount: number }[];
}) {
  const years = Array.from(new Set(cells.map((c) => c.year))).sort((a, b) => a - b);
  const total = cells.reduce((s, c) => s + c.amount, 0);
  const max = Math.max(1, ...cells.map((c) => c.amount));

  const shade = (amount: number) => {
    if (amount <= 0) return "bg-muted";
    const ratio = amount / max;
    if (ratio > 0.75) return "bg-emerald-600";
    if (ratio > 0.5) return "bg-emerald-500";
    if (ratio > 0.25) return "bg-emerald-300";
    return "bg-emerald-100";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ActivityIcon className="h-4 w-4 text-muted-foreground" />
          Rent received
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {fmtCurrency(total)} · last {years.length} years
        </span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[420px] space-y-1">
            <div className="grid grid-cols-[2.5rem_repeat(12,1fr)] gap-1 text-[10px] text-muted-foreground">
              <span />
              {MONTH_LABELS.map((m, i) => (
                <span key={i} className="text-center">
                  {m}
                </span>
              ))}
            </div>
            {years.map((year) => (
              <div key={year} className="grid grid-cols-[2.5rem_repeat(12,1fr)] gap-1">
                <span className="text-[10px] text-muted-foreground">{year}</span>
                {Array.from({ length: 12 }, (_, m) =>
                  cells.find((c) => c.year === year && c.month === m),
                ).map((cell, m) => (
                  <div
                    key={m}
                    title={
                      cell && cell.amount > 0
                        ? `${MONTH_LABELS[m]} ${year}: ${fmtCurrency(cell.amount)}`
                        : undefined
                    }
                    className={`aspect-square rounded-sm ${shade(cell?.amount ?? 0)}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
