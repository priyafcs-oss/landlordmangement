import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AddBillDialog } from "@/components/AddBillDialog";
import { BillDetailDialog } from "@/components/BillDetailDialog";
import { CheckCircle2, MoreVertical, Receipt, Search } from "lucide-react";
import { fmtCurrency, todayISO } from "@/lib/calculations";
import type { AssetType, BillType } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/bills")({
  head: () => ({
    meta: [
      { title: "Bills — Landlord OS" },
      { name: "description", content: "Every outstanding bill across the portfolio, in one place." },
    ],
  }),
  component: BillsPage,
});

const STATUS_OPTIONS = ["__all__", "Unpaid", "Overdue", "Paid"] as const;
const BILL_TYPES: BillType[] = ["Water", "Council Rates", "Strata", "Insurance", "Electricity", "Gas", "Other"];
const TYPE_COLORS = ["bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-cyan-500", "bg-slate-500"];

function BillsPage() {
  const { state, markBillPaid, deleteBill } = useStore();
  const [propertyId, setPropertyId] = useState("__all__");
  const [assetType, setAssetType] = useState<"__all__" | AssetType>("__all__");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("__all__");
  const [billType, setBillType] = useState<"__all__" | BillType>("__all__");
  const [query, setQuery] = useState("");

  const today = todayISO();
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const isOverdue = (b: (typeof state.bills)[number]) => b.status === "Unpaid" && b.dueDate < today;
  const assetTypeOf = (b: (typeof state.bills)[number]) => state.assets.find((a) => a.id === b.assetId)?.assetType;
  const propertyLabelOf = (b: (typeof state.bills)[number]) => {
    const p = state.properties.find((pr) => pr.id === b.propertyId);
    return p?.alias || p?.address || state.assets.find((a) => a.id === b.assetId)?.name;
  };

  const filtered = state.bills
    .filter((b) => propertyId === "__all__" || b.propertyId === propertyId)
    .filter((b) => assetType === "__all__" || assetTypeOf(b) === assetType)
    .filter((b) => billType === "__all__" || b.billType === billType)
    .filter((b) => {
      if (status === "__all__") return true;
      if (status === "Overdue") return isOverdue(b);
      if (status === "Unpaid") return b.status === "Unpaid" && !isOverdue(b);
      return b.status === "Paid";
    })
    .filter((b) => {
      if (!query) return true;
      const haystack = `${b.billType} ${b.providerName ?? ""} ${propertyLabelOf(b) ?? ""}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  const outstanding = state.bills.filter((b) => b.status !== "Paid");
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
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">Every bill across the portfolio — nothing slides quietly.</p>
        </div>
        <AddBillDialog />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search bills…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-[180px] pl-7" />
            </div>
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
          </div>

          <Card>
            {filtered.length === 0 ? (
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                <Receipt className="mx-auto mb-2 h-6 w-6" />
                No bills match these filters.
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Due Date</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium">Provider</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((b) => {
                      const overdue = isOverdue(b);
                      return (
                        <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="whitespace-nowrap px-3 py-2 text-xs">{b.dueDate}</td>
                          <td className="px-3 py-2">
                            <BillDetailDialog
                              bill={b}
                              propertyLabel={propertyLabelOf(b)}
                              trigger={
                                <button type="button" className="text-left hover:underline">
                                  <div className="font-medium">{propertyLabelOf(b) ?? b.billType}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {b.billType}
                                    {b.label ? ` · ${b.label}` : ""}
                                    {b.status === "Paid" ? " · paid" : overdue ? " · overdue" : ""}
                                  </div>
                                </button>
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-xs">{b.providerName ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{b.source ?? "Manual"}</td>
                          <td className={"px-3 py-2 text-right font-medium " + (overdue ? "text-destructive" : "")}>
                            {fmtCurrency(b.amount)}
                          </td>
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
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

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
                  <div className="text-xs text-muted-foreground">due across the portfolio</div>
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
      </div>
    </div>
  );
}
