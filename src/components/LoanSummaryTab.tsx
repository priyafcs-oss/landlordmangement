import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtCurrency } from "@/lib/calculations";

/** Portfolio-wide loan rollup — reachable from the Assets left-nav. */
export function LoanSummaryTab() {
  const { state } = useStore();
  const totalBalance = state.loans.reduce((s, l) => s + l.totalBalance, 0);
  const totalEmi = state.loans.reduce((s, l) => s + l.monthlyEmi, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Loan Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.loans.length === 0 && <div className="text-sm text-muted-foreground">No loans on file.</div>}
        {state.loans.map((l) => {
          const prop = state.properties.find((p) => p.id === l.propertyId);
          return (
            <div key={l.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {l.bankName} — {prop?.alias || prop?.address || "Unlinked"}
                </span>
                <Badge variant={l.status === "Paid Off" ? "secondary" : l.status === "In Arrears" ? "destructive" : "outline"}>
                  {l.status ?? "Active"}
                </Badge>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <span>Balance: {fmtCurrency(l.totalBalance)}</span>
                <span>Rate: {l.interestRate}%</span>
                <span>EMI: {fmtCurrency(l.monthlyEmi)}</span>
              </div>
            </div>
          );
        })}
        {state.loans.length > 0 && (
          <div className="flex justify-between border-t pt-2 text-sm font-medium">
            <span>Total</span>
            <span>
              {fmtCurrency(totalBalance)} balance • {fmtCurrency(totalEmi)}/mo
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
