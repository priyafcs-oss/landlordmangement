import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtCurrency, ausFinancialYear, fyRange, todayISO, daysInclusive, buildFyOptions } from "@/lib/calculations";

/** Portfolio-wide Cost Base — same estimate PropertyCostBaseTab computes per property
 * (purchase price + stamp duty + capital-works expenses), summed across every property. */
export function PortfolioCostBaseTab() {
  const { state } = useStore();
  const rows = state.properties.map((p) => {
    const capitalWorks = state.expenses
      .filter((e) => e.propertyId === p.id && e.taxCategory === "Capital Works")
      .reduce((s, e) => s + e.cost, 0);
    const costBase = p.purchasePrice + (p.stampDuty ?? 0) + capitalWorks;
    return { property: p, capitalWorks, costBase };
  });
  const total = rows.reduce((s, r) => s + r.costBase, 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Estimate only — purchase price + stamp duty + capital-works expenses per property. Not adjusted for
        depreciation; talk to your accountant for the actual CGT cost base.
      </p>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Property</th>
                <th className="px-3 py-2 text-right font-medium">Purchase price</th>
                <th className="px-3 py-2 text-right font-medium">Stamp duty</th>
                <th className="px-3 py-2 text-right font-medium">Capital works</th>
                <th className="px-3 py-2 text-right font-medium">Cost base</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-xs text-muted-foreground">
                    No properties yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.property.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{r.property.alias || r.property.address}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.property.purchasePrice)}</td>
                  <td className="px-3 py-2 text-right">{r.property.stampDuty ? fmtCurrency(r.property.stampDuty) : "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.capitalWorks)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtCurrency(r.costBase)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-3 py-2" colSpan={4}>
                    Portfolio total
                  </td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}

/** Portfolio-wide Depreciation — every logged item across every property's linked asset,
 * grouped by property, same prime-cost formula as the per-property DepreciationTab. */
export function PortfolioDepreciationTab() {
  const { state } = useStore();
  const rows = state.properties.map((p) => {
    const items = p.assetId ? state.depreciationItems.filter((d) => d.assetId === p.assetId) : [];
    const annual = items.reduce((s, d) => s + d.purchaseCost / (d.effectiveLifeYears || 1), 0);
    return { property: p, items, annual };
  });
  const totalAnnual = rows.reduce((s, r) => s + r.annual, 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        A simplified prime-cost log (cost ÷ effective life = annual claim) across every property — not a full ATO
        Div 40/43 diminishing-value schedule.
      </p>
      {rows.filter((r) => r.items.length > 0).length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">No depreciation items logged yet.</CardContent>
        </Card>
      )}
      {rows
        .filter((r) => r.items.length > 0)
        .map((r) => (
          <Card key={r.property.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{r.property.alias || r.property.address}</div>
                <div className="text-xs text-muted-foreground">{fmtCurrency(r.annual)}/yr</div>
              </div>
              {r.items.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded border p-2 text-xs">
                  <div>
                    <div className="font-medium">{d.description}</div>
                    <div className="text-muted-foreground">
                      {fmtCurrency(d.purchaseCost)} over {d.effectiveLifeYears}y
                    </div>
                  </div>
                  <div>{fmtCurrency(d.purchaseCost / (d.effectiveLifeYears || 1))}/yr</div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      {totalAnnual > 0 && (
        <div className="flex justify-between border-t pt-2 text-sm font-medium">
          <span>Portfolio total annual claim</span>
          <span>{fmtCurrency(totalAnnual)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Portfolio-wide YTD P&L — the exact same statement shape and math as PropertyPnLTab (FY
 * selector capped to today for the current year, income/expense-by-category split, day-prorated
 * loan interest), just aggregated across every property instead of one. Kept in lockstep with
 * PropertyPnLTab's formula deliberately: this used to be a simpler standalone rollup (flat gross
 * rent − all expenses − a full year's loan interest regardless of period length) that quietly
 * drifted from what the per-property tab actually shows.
 */
export function PortfolioPnLTab() {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const [fy, setFy] = useState(currentFY);
  const fyOptions = useMemo(() => buildFyOptions(7).filter((y) => y <= currentFY).reverse(), [currentFY]);
  const isCurrentFY = fy === currentFY;
  const { start, end: fyEnd } = fyRange(fy);
  // The current FY isn't over yet — showing it as year-to-date (rather than projecting a full
  // year that hasn't happened) matches how a landlord actually reads "where do I stand right now".
  const end = isCurrentFY ? todayISO() : fyEnd;

  const rows = state.properties.map((p) => {
    const tenantIds = state.tenants.filter((t) => t.propertyId === p.id).map((t) => t.id);
    const grossRent = state.ledger
      .filter((e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end)
      .reduce((s, e) => s + e.credit, 0);

    const periodExpenses = state.expenses.filter((e) => e.propertyId === p.id && e.date >= start && e.date <= end);
    const outgoing = periodExpenses.filter((e) => e.direction !== "Income");
    const extraIncome = periodExpenses.filter((e) => e.direction === "Income");
    const totalIncome = grossRent + extraIncome.reduce((s, e) => s + e.cost, 0);

    const loan = state.loans.find((l) => l.propertyId === p.id);
    const loanInterest = loan ? (((loan.totalBalance * loan.interestRate) / 100) * daysInclusive(start, end)) / 365 : 0;
    const totalExpenses = outgoing.reduce((s, e) => s + e.cost, 0) + loanInterest;

    return { property: p, grossRent, extraIncome, outgoing, loanInterest, totalIncome, totalExpenses, net: totalIncome - totalExpenses };
  });

  // Same itemized income/expense-by-category breakdown as PropertyPnLTab's main statement,
  // just summed across every property's own categorized lines instead of one.
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};
  for (const r of rows) {
    if (r.grossRent) incomeByCategory["Rent"] = (incomeByCategory["Rent"] ?? 0) + r.grossRent;
    for (const e of r.extraIncome) {
      const cat = e.category ?? "Other Income";
      incomeByCategory[cat] = (incomeByCategory[cat] ?? 0) + e.cost;
    }
    for (const e of r.outgoing) {
      const cat = e.category ?? "Other";
      expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + e.cost;
    }
    if (r.loanInterest > 0) expenseByCategory["Loan Interest (est.)"] = (expenseByCategory["Loan Interest (est.)"] ?? 0) + r.loanInterest;
  }
  const incomeLines = Object.entries(incomeByCategory)
    .filter(([, amount]) => amount !== 0)
    .sort((a, b) => b[1] - a[1]);
  const expenseLines = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
  const totalIncome = rows.reduce((s, r) => s + r.totalIncome, 0);
  const totalExpenses = rows.reduce((s, r) => s + r.totalExpenses, 0);
  const netCashflow = totalIncome - totalExpenses;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {fyOptions.map((y) => (
          <Button key={y} size="sm" variant={fy === y ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setFy(y)}>
            FY {y}
            {y === currentFY ? " · YTD" : ""}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Portfolio Profit &amp; Loss — FY {fy}
            {isCurrentFY ? " YTD" : ""}
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            {start} to {end} · {state.properties.length} propert{state.properties.length === 1 ? "y" : "ies"}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="text-xs font-medium text-emerald-600">Income</div>
            {incomeLines.length === 0 && <div className="text-xs text-muted-foreground">No income in this period.</div>}
            {incomeLines.map(([label, amount]) => (
              <div key={label} className="flex justify-between">
                <span>{label}</span>
                <span>{fmtCurrency(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 font-medium">
              <span>Total Income</span>
              <span>{fmtCurrency(totalIncome)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-destructive">Expenses</div>
            {expenseLines.length === 0 && <div className="text-xs text-muted-foreground">No expenses in this period.</div>}
            {expenseLines.map(([label, amount]) => (
              <div key={label} className="flex justify-between">
                <span>{label}</span>
                <span>{fmtCurrency(amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 font-medium">
              <span>Total Expenses</span>
              <span>{fmtCurrency(totalExpenses)}</span>
            </div>
          </div>

          <div className="space-y-0.5 border-t pt-2">
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Net Cashflow</span>
              <span className={netCashflow < 0 ? "text-destructive" : "text-emerald-600"}>
                {netCashflow < 0 ? "−" : ""}
                {fmtCurrency(Math.abs(netCashflow))}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">Income − cash expenses; depreciation excluded</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">By property</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Property</th>
                <th className="px-3 py-2 text-right font-medium">Income</th>
                <th className="px-3 py-2 text-right font-medium">Expenses</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-xs text-muted-foreground">
                    No properties yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.property.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{r.property.alias || r.property.address}</td>
                  <td className="px-3 py-2 text-right text-emerald-600">{fmtCurrency(r.totalIncome)}</td>
                  <td className="px-3 py-2 text-right text-destructive">{fmtCurrency(r.totalExpenses)}</td>
                  <td className={"px-3 py-2 text-right font-medium " + (r.net < 0 ? "text-destructive" : "")}>{fmtCurrency(r.net)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-3 py-2">Portfolio total</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(totalIncome)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(totalExpenses)}</td>
                  <td className={"px-3 py-2 text-right " + (netCashflow < 0 ? "text-destructive" : "")}>{fmtCurrency(netCashflow)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
