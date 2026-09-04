import { useStore } from "@/lib/store";
import { fmtCurrency } from "@/lib/calculations";
import { CollapsibleGroupSection } from "@/components/CollapsibleGroupSection";
import { DocumentLink } from "@/components/DocumentLink";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Per-loan statement history — the interest/principal breakdown across every applied
 * loan_statement proposal (LoanStatementProposalCard's "Apply to loan"), plus a link back to
 * each statement's own source PDF. Collapsed behind a disclosure, and renders nothing at all
 * when a loan has no applied statements yet, so it never bloats a loan card that's only ever
 * been entered/edited manually. */
export function LoanStatementHistory({ loanId }: { loanId: string }) {
  const { state, deleteLoanStatement, deleteExpense } = useStore();
  const statements = state.loanStatements
    .filter((s) => s.loanId === loanId)
    .sort((a, b) => (a.periodEnd ?? a.appliedAt ?? "").localeCompare(b.periodEnd ?? b.appliedAt ?? ""));

  if (statements.length === 0) return null;

  const removeStatement = (id: string, expenseId?: string) => {
    if (!confirm(expenseId ? "Delete this statement entry and its logged interest expense?" : "Delete this statement entry?")) return;
    deleteLoanStatement(id);
    if (expenseId) deleteExpense(expenseId);
    toast.success("Statement entry removed");
  };

  const chartData = statements.map((s) => ({
    name: s.periodEnd?.slice(0, 7) ?? s.periodStart?.slice(0, 7) ?? "—",
    interestCharged: s.interestCharged ?? 0,
    principalPaid: s.principalPaid ?? 0,
  }));

  return (
    <CollapsibleGroupSection label="Statement history" summary={<span>{statements.length}</span>}>
      <div className="space-y-3 p-3">
        <ChartContainer
          className="h-[160px] w-full"
          config={{
            interestCharged: { label: "Interest", color: "hsl(var(--destructive))" },
            principalPaid: { label: "Principal", color: "hsl(var(--primary))" },
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={60} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="interestCharged" stackId="a" fill="var(--color-interestCharged)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="principalPaid" stackId="a" fill="var(--color-principalPaid)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>

        <div className="space-y-1">
          {statements.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
              <span className="text-muted-foreground">
                {s.periodStart || "—"} → {s.periodEnd || "—"}
              </span>
              <span>Interest {s.interestCharged !== undefined ? fmtCurrency(s.interestCharged) : "—"}</span>
              <span>Principal {s.principalPaid !== undefined ? fmtCurrency(s.principalPaid) : "—"}</span>
              <span>Balance {s.closingBalance !== undefined ? fmtCurrency(s.closingBalance) : "—"}</span>
              {s.sourceFileData && (
                <DocumentLink fileName={s.sourceFileName} fileData={s.sourceFileData} className="inline-flex items-center gap-1 text-primary underline">
                  <FileText className="h-3 w-3 shrink-0" /> Statement
                </DocumentLink>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                title="Delete this entry"
                onClick={() => removeStatement(s.id, s.expenseId)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </CollapsibleGroupSection>
  );
}
