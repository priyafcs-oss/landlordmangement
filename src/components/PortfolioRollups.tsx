import { useStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { fmtCurrency, ausFinancialYear, fyRange, todayISO } from "@/lib/calculations";

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

/** Portfolio-wide YTD P&L — same per-property formula as PropertyPnLTab (gross rent − expenses −
 * estimated loan interest), summed across every property for the current financial year. */
export function PortfolioPnLTab() {
  const { state } = useStore();
  const currentFY = ausFinancialYear(todayISO());
  const { start, end } = fyRange(currentFY);

  const rows = state.properties.map((p) => {
    const tenantIds = state.tenants.filter((t) => t.propertyId === p.id).map((t) => t.id);
    const grossRent = state.ledger
      .filter((e) => tenantIds.includes(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end)
      .reduce((s, e) => s + e.credit, 0);
    const totalExpenses = state.expenses
      .filter((e) => e.propertyId === p.id && e.date >= start && e.date <= end)
      .reduce((s, e) => s + e.cost, 0);
    const loan = state.loans.find((l) => l.propertyId === p.id);
    const loanInterest = loan ? (loan.totalBalance * loan.interestRate) / 100 : 0;
    return { property: p, grossRent, totalExpenses, loanInterest, net: grossRent - totalExpenses - loanInterest };
  });
  const totals = rows.reduce(
    (acc, r) => ({
      grossRent: acc.grossRent + r.grossRent,
      totalExpenses: acc.totalExpenses + r.totalExpenses,
      loanInterest: acc.loanInterest + r.loanInterest,
      net: acc.net + r.net,
    }),
    { grossRent: 0, totalExpenses: 0, loanInterest: 0, net: 0 },
  );

  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground">FY {currentFY}</div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Property</th>
                <th className="px-3 py-2 text-right font-medium">Gross rent</th>
                <th className="px-3 py-2 text-right font-medium">Expenses</th>
                <th className="px-3 py-2 text-right font-medium">Loan interest</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
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
                  <td className="px-3 py-2 text-right text-emerald-600">{fmtCurrency(r.grossRent)}</td>
                  <td className="px-3 py-2 text-right text-destructive">{fmtCurrency(r.totalExpenses)}</td>
                  <td className="px-3 py-2 text-right text-destructive">{fmtCurrency(r.loanInterest)}</td>
                  <td className={"px-3 py-2 text-right font-medium " + (r.net < 0 ? "text-destructive" : "")}>{fmtCurrency(r.net)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-3 py-2">Portfolio total</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(totals.grossRent)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(totals.totalExpenses)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(totals.loanInterest)}</td>
                  <td className={"px-3 py-2 text-right " + (totals.net < 0 ? "text-destructive" : "")}>{fmtCurrency(totals.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
