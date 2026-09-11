import { useState } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, FileUp, Repeat, ChevronDown, ChevronRight } from "lucide-react";
import { fmtCurrency } from "@/lib/calculations";
import { AddLoanDialog } from "@/components/AddLoanDialog";
import { LoanStatementHistory } from "@/components/LoanStatementHistory";
import { UploadDocumentDialog } from "@/components/UploadDocumentDialog";
import type { Loan } from "@/lib/types";

function LoanRow({ loan: l, propertyLabel }: { loan: Loan; propertyLabel: string }) {
  const historic = l.status === "Paid Off";
  return (
    <div className={`rounded-md border p-3 text-sm ${historic ? "bg-muted/20" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {l.bankName} — {propertyLabel}
        </span>
        <div className="flex items-center gap-1">
          <Badge variant={l.status === "Paid Off" ? "secondary" : l.status === "In Arrears" ? "destructive" : "outline"}>
            {l.status ?? "Active"}
          </Badge>
          <UploadDocumentDialog
            loanId={l.id}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Upload statement">
                <FileUp className="h-3 w-3" />
              </Button>
            }
          />
          {!historic && (
            <AddLoanDialog
              refinanceFrom={l}
              propertyId={l.propertyId}
              trigger={
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs">
                  <Repeat className="h-3 w-3" /> Refinance
                </Button>
              }
            />
          )}
          <AddLoanDialog
            loan={l}
            trigger={
              <Button size="icon" variant="ghost" className="h-6 w-6">
                <Pencil className="h-3 w-3" />
              </Button>
            }
          />
        </div>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span>Balance: {fmtCurrency(l.totalBalance)}</span>
        <span>Rate: {l.interestRate}%</span>
        <span>EMI: {fmtCurrency(l.monthlyEmi)}</span>
      </div>
      <div className="mt-2">
        <LoanStatementHistory loanId={l.id} />
      </div>
    </div>
  );
}

/** Portfolio-wide loan rollup — reachable from the Assets left-nav. */
export function LoanSummaryTab() {
  const { state } = useStore();
  const [showHistory, setShowHistory] = useState(false);
  const activeLoans = state.loans.filter((l) => l.status !== "Paid Off");
  const historicLoans = state.loans.filter((l) => l.status === "Paid Off");
  // Excludes paid-off/historic loans — a refinanced-away loan's stale balance/EMI shouldn't still
  // count toward what's actually owing or due each month.
  const totalBalance = activeLoans.reduce((s, l) => s + l.totalBalance, 0);
  const totalEmi = activeLoans.reduce((s, l) => s + l.monthlyEmi, 0);
  const propertyLabelOf = (l: Loan) => {
    const prop = state.properties.find((p) => p.id === l.propertyId);
    return prop?.alias || prop?.address || "Unlinked";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Loan Summary</CardTitle>
        <AddLoanDialog />
      </CardHeader>
      <CardContent className="space-y-3">
        {activeLoans.length === 0 && <div className="text-sm text-muted-foreground">No active loans on file.</div>}
        {activeLoans.map((l) => (
          <LoanRow key={l.id} loan={l} propertyLabel={propertyLabelOf(l)} />
        ))}
        {activeLoans.length > 0 && (
          <div className="flex justify-between border-t pt-2 text-sm font-medium">
            <span>Total</span>
            <span>
              {fmtCurrency(totalBalance)} balance • {fmtCurrency(totalEmi)}/mo
            </span>
          </div>
        )}
        {historicLoans.length > 0 && (
          <div className="border-t pt-2">
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Loan history ({historicLoans.length})
            </button>
            {showHistory && (
              <div className="mt-2 space-y-3">
                {historicLoans.map((l) => (
                  <LoanRow key={l.id} loan={l} propertyLabel={propertyLabelOf(l)} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
