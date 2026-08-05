import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "portfolio_summary",
  title: "Portfolio summary",
  description:
    "Summarise portfolio wealth and cash flow: total market value, total debt, equity, annualised rent roll and unpaid invoices.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const [properties, loans, tenants, invoices, expenses] = await Promise.all([
      supabase.from("properties").select("*"),
      supabase.from("loans").select("*"),
      supabase.from("tenants").select("rentAmount,rentFrequency"),
      supabase.from("tenant_invoices").select("amountDue,status"),
      supabase.from("expenses").select("cost"),
    ]);
    for (const res of [properties, loans, tenants, invoices, expenses]) {
      if (res.error) return errorResult(res.error.message);
    }
    const num = (v: unknown) => Number(v) || 0;
    const totalValue = (properties.data ?? []).reduce((s: number, p: any) => s + num(p.currentValue), 0);
    const loanDebt = (loans.data ?? []).reduce((s: number, l: any) => s + num(l.balance ?? l.totalBalance), 0);
    const inlineDebt = (properties.data ?? []).reduce((s: number, p: any) => s + num(p.loanBalance), 0);
    const totalDebt = loanDebt > 0 ? loanDebt : inlineDebt;
    const perYear = { Weekly: 52, Fortnightly: 26, Monthly: 12 } as Record<string, number>;
    const annualRent = (tenants.data ?? []).reduce(
      (s: number, t: any) => s + num(t.rentAmount) * (perYear[t.rentFrequency] ?? 12),
      0,
    );
    const unpaidInvoices = (invoices.data ?? [])
      .filter((i: any) => i.status !== "Paid")
      .reduce((s: number, i: any) => s + num(i.amountDue), 0);
    const totalExpenses = (expenses.data ?? []).reduce((s: number, e: any) => s + num(e.cost), 0);
    return textResult({
      propertyCount: properties.data?.length ?? 0,
      totalMarketValue: totalValue,
      totalDebt,
      equity: totalValue - totalDebt,
      annualisedRentRoll: annualRent,
      unpaidInvoices,
      totalExpensesLogged: totalExpenses,
    });
  },
});
