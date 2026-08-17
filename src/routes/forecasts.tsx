import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtCurrency } from "@/lib/calculations";

export const Route = createFileRoute("/forecasts")({
  head: () => ({
    meta: [
      { title: "Forecasts — Landlord OS" },
      { name: "description", content: "A simple cashflow and equity projection based on known bills, loans and rent." },
    ],
  }),
  component: ForecastsPage,
});

function monthlyRent(rentAmount: number, frequency: string): number {
  if (frequency === "Weekly") return rentAmount * 4.33;
  if (frequency === "Fortnightly") return rentAmount * 2.17;
  return rentAmount;
}

function ForecastsPage() {
  const { state } = useStore();
  const [months, setMonths] = useState<3 | 6 | 12>(6);

  const activeTenants = state.tenants.filter((t) => !t.leaseExpiry || t.leaseExpiry >= new Date().toISOString().slice(0, 10));
  const knownMonthlyRent = activeTenants.reduce((s, t) => s + monthlyRent(t.rentAmount, t.rentFrequency), 0);
  const monthlyEmiTotal = state.loans.reduce((s, l) => s + l.monthlyEmi, 0);

  const cashflowRows: { name: string; rent: number; bills: number; emis: number; net: number }[] = [];
  const equityRows: { name: string; loanBalance: number; equity: number }[] = [];

  const totalValue = state.assets.filter((a) => a.status === "Active").reduce((s, a) => s + a.currentValue, 0);
  let projectedBalances = state.loans.map((l) => ({ id: l.id, balance: l.totalBalance, rate: l.interestRate, emi: l.monthlyEmi }));

  for (let i = 0; i < months; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() + i + 1);
    const key = d.toISOString().slice(0, 7);
    const name = d.toLocaleString("en-AU", { month: "short", year: "2-digit" });

    const billsDue = state.bills
      .filter((b) => b.status !== "Paid" && b.dueDate.startsWith(key))
      .reduce((s, b) => s + b.amount, 0);

    cashflowRows.push({
      name,
      rent: knownMonthlyRent,
      bills: billsDue,
      emis: monthlyEmiTotal,
      net: knownMonthlyRent - billsDue - monthlyEmiTotal,
    });

    projectedBalances = projectedBalances.map((l) => {
      const interest = (l.balance * l.rate) / 100 / 12;
      const principalPaid = Math.max(0, l.emi - interest);
      return { ...l, balance: Math.max(0, l.balance - principalPaid) };
    });
    const loanBalance = projectedBalances.reduce((s, l) => s + l.balance, 0);
    equityRows.push({ name, loanBalance, equity: totalValue - loanBalance });
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Forecasts</h1>
        <p className="text-sm text-muted-foreground">
          Based on known bills, current loan balances and current tenant rent — not a prediction of rent changes,
          vacancies or capital growth.
        </p>
      </div>

      <div className="flex gap-1">
        {[3, 6, 12].map((m) => (
          <Button key={m} size="sm" variant={months === m ? "secondary" : "ghost"} onClick={() => setMonths(m as 3 | 6 | 12)}>
            {m}M
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cashflow forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-1 text-left">Month</th>
                  <th className="py-1 text-right">Known rent</th>
                  <th className="py-1 text-right">Bills due</th>
                  <th className="py-1 text-right">Loan repayments</th>
                  <th className="py-1 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {cashflowRows.map((r) => (
                  <tr key={r.name} className="border-b last:border-0">
                    <td className="py-1.5">{r.name}</td>
                    <td className="py-1.5 text-right text-emerald-600">{fmtCurrency(r.rent)}</td>
                    <td className="py-1.5 text-right text-destructive">{r.bills ? `−${fmtCurrency(r.bills)}` : "—"}</td>
                    <td className="py-1.5 text-right text-destructive">{r.emis ? `−${fmtCurrency(r.emis)}` : "—"}</td>
                    <td className={`py-1.5 text-right font-medium ${r.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                      {fmtCurrency(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equity forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">
            Loan paydown projected from current balance, rate and repayment — property/asset values held flat, no
            capital-growth assumption.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-1 text-left">Month</th>
                  <th className="py-1 text-right">Projected loan balance</th>
                  <th className="py-1 text-right">Projected equity</th>
                </tr>
              </thead>
              <tbody>
                {equityRows.map((r) => (
                  <tr key={r.name} className="border-b last:border-0">
                    <td className="py-1.5">{r.name}</td>
                    <td className="py-1.5 text-right">{fmtCurrency(r.loanBalance)}</td>
                    <td className="py-1.5 text-right font-medium">{fmtCurrency(r.equity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
