import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Receipt } from "lucide-react";
import { fmtCurrency, ausFinancialYear, fyRange, todayISO } from "@/lib/calculations";
import { downloadCsv } from "@/lib/csv";
import { toast } from "sonner";

export const Route = createFileRoute("/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions — Landlord OS" },
      { name: "description", content: "Every income and expense line item across the portfolio, in one ledger." },
    ],
  }),
  component: TransactionsPage,
});

interface TxRow {
  id: string;
  date: string;
  description: string;
  category: string;
  propertyId?: string;
  amount: number; // positive = income, negative = outgoing
}

function TransactionsPage() {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [fy, setFy] = useState(currentFY);
  const [propertyId, setPropertyId] = useState("__all__");
  const { start, end } = fyRange(fy);

  const fys = useMemo(() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(`${y}-${y + 1}`);
    return years;
  }, []);

  // Normalize three independent sources into one row shape. Note: a bill marked Paid here and
  // separately logged as an Expense will double-count — the two datasets aren't linked today.
  const allRows: TxRow[] = [
    ...state.ledger
      .filter((e) => e.credit > 0)
      .map((e) => {
        const tenant = state.tenants.find((t) => t.id === e.tenantId);
        return {
          id: `ledg_${e.id}`,
          date: e.date,
          description: `${e.type} — ${tenant?.name ?? "Unknown tenant"}`,
          category: e.type,
          propertyId: tenant?.propertyId,
          amount: e.credit,
        };
      }),
    ...state.expenses.map((e) => ({
      id: `exp_${e.id}`,
      date: e.date,
      description: e.itemName,
      category: e.taxCategory,
      propertyId: e.propertyId,
      amount: -e.cost,
    })),
    ...state.bills
      .filter((b) => b.status === "Paid")
      .map((b) => ({
        id: `bill_${b.id}`,
        date: b.paidDate ?? b.dueDate,
        description: `${b.billType} bill`,
        category: b.billType,
        propertyId: b.propertyId,
        amount: -b.amount,
      })),
  ];

  const filtered = allRows
    .filter((r) => r.date >= start && r.date <= end)
    .filter((r) => propertyId === "__all__" || r.propertyId === propertyId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const totalIncome = filtered.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalExpenses = filtered.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const byCategory = filtered
    .filter((r) => r.amount < 0)
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + Math.abs(r.amount);
      return acc;
    }, {});

  const exportCsv = () => {
    const header = ["Date", "Description", "Category", "Property", "Amount"];
    const rows = filtered.map((r) => {
      const prop = state.properties.find((p) => p.id === r.propertyId);
      return [r.date, r.description, r.category, prop?.alias || prop?.address || "", r.amount];
    });
    downloadCsv(`transactions-${fy}.csv`, header, rows);
    toast.success("Transactions CSV downloaded");
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">Every income and expense line item across the portfolio.</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fys.map((y) => (
                  <SelectItem key={y} value={y}>
                    FY {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="w-[200px]">
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
          </div>

          <div className="space-y-2">
            {filtered.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  <Receipt className="mx-auto mb-2 h-6 w-6" />
                  No transactions in this range.
                </CardContent>
              </Card>
            )}
            {filtered.map((r) => {
              const prop = state.properties.find((p) => p.id === r.propertyId);
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{r.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.date} • {r.category}
                      {prop && <> • {prop.alias || prop.address}</>}
                    </div>
                  </div>
                  <div className={`shrink-0 font-medium ${r.amount < 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {r.amount < 0 ? "−" : "+"}
                    {fmtCurrency(Math.abs(r.amount))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary — FY {fy}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Income</span>
                <span className="font-medium text-emerald-600">{fmtCurrency(totalIncome)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expenses</span>
                <span className="font-medium text-destructive">{fmtCurrency(Math.abs(totalExpenses))}</span>
              </div>
              <div className="mt-2 flex justify-between border-t pt-2">
                <span className="font-medium">Net</span>
                <span className="font-semibold">{fmtCurrency(totalIncome + totalExpenses)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where money goes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.keys(byCategory).length === 0 && <div className="text-xs text-muted-foreground">No expenses in this range.</div>}
              {Object.entries(byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amount]) => (
                  <div key={cat} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{cat}</span>
                    <span className="font-medium">{fmtCurrency(amount)}</span>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
