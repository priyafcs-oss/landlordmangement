import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildTenantLedger,
  fmtCurrency,
  daysUntil,
  todayISO,
  daysBetween,
} from "@/lib/calculations";
import { AlertTriangle, TrendingUp, ShieldCheck, ClipboardCheck, Wallet, Landmark, ArrowRight, Wrench } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

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
  const totalValue = state.properties.reduce((s, p) => s + p.currentValue, 0);
  const totalDebt = state.loans.reduce((s, l) => s + l.totalBalance, 0);
  const equity = totalValue - totalDebt;

  const rentReceived = state.ledger.reduce((s, e) => s + (e.type === "Rent Payment" ? e.credit : 0), 0);
  const invoicesReceived = state.ledger.reduce(
    (s, e) => s + ((e.type === "Water Invoice" || e.type === "Maintenance Charge") ? e.credit : 0),
    0,
  );
  const totalEmis = state.loans.reduce((s, l) => s + l.monthlyEmi, 0);
  const totalExpenses = state.expenses.reduce((s, e) => s + e.cost, 0);
  const netCashFlow = rentReceived + invoicesReceived - totalEmis - totalExpenses;

  const leaseAlerts = state.tenants.filter((t) => {
    if (!t.leaseExpiry) return false;
    const d = daysUntil(t.leaseExpiry);
    return d >= 0 && d <= 60;
  });

  const warrantyAlerts = state.expenses.filter((e) => {
    if (!e.hasWarranty || !e.warrantyExpiry) return false;
    const d = daysUntil(e.warrantyExpiry);
    return d >= 0 && d <= 90;
  });

  const complianceAlerts = state.properties.filter((p) => {
    const insp = state.inspections
      .filter((i) => i.propertyId === p.id && i.status === "Completed")
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!insp) return true;
    return daysBetween(insp.date, todayISO()) > 180;
  });

  // Chart data: last 6 months synthetic based on ledger + emis
  const months: { name: string; cashflow: number; equity: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    const income = state.ledger
      .filter((e) => e.date.startsWith(key))
      .reduce((s, e) => s + e.credit, 0);
    const exp = state.expenses.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.cost, 0);
    months.push({
      name: d.toLocaleString("en-AU", { month: "short" }),
      cashflow: income - exp - totalEmis,
      equity: equity - i * 2500,
    });
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio Dashboard</h1>
        <p className="text-sm text-muted-foreground">Wealth, cash flow, and proactive compliance signals.</p>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Monthly cash flow &amp; equity</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-[240px] w-full"
              config={{
                cashflow: { label: "Cash flow", color: "hsl(var(--primary))" },
                equity: { label: "Equity", color: "hsl(var(--muted-foreground))" },
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={months}>
                  <defs>
                    <linearGradient id="c1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="cashflow" stroke="var(--color-primary)" fill="url(#c1)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-blue-600" />
              Compliance: inspections
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {complianceAlerts.length === 0 && <div className="text-muted-foreground">All properties inspected recently.</div>}
            {complianceAlerts.map((p) => (
              <div key={p.id} className="rounded-md border p-3">
                <div className="font-medium">{p.address}</div>
                <div className="text-xs text-muted-foreground">No inspection logged in the last 6 months.</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <HousekeepingWidget />

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
      taxCategory: "Immediate Deduction",
      hasWarranty: false,
      rechargeToTenant: false,
    });
    updateMaintenanceRequest(id, { status: "Converted" });
    toast.success("Converted to expense — update cost on the Expenses tab");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-orange-600" />
          Tenant maintenance requests ({pending.length})
          <Button asChild variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs">
            <Link to="/maintenance">Open public form</Link>
          </Button>
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
