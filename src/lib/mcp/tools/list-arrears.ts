import { defineTool } from "@lovable.dev/mcp-js";
import { dailyRentRate, daysBetween, todayISO } from "@/lib/calculations";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_arrears",
  title: "List tenants in arrears",
  description:
    "Show which tenants are behind on rent right now, with days in arrears, rent owing and unpaid invoice totals.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const [tenants, properties, invoices] = await Promise.all([
      supabase.from("tenants").select("*"),
      supabase.from("properties").select("id,address"),
      supabase.from("tenant_invoices").select("*"),
    ]);
    for (const res of [tenants, properties, invoices]) {
      if (res.error) return errorResult(res.error.message);
    }
    const addressById = new Map((properties.data ?? []).map((p: any) => [p.id, p.address]));
    const today = todayISO();
    const rows = (tenants.data ?? []).map((t: any) => {
      const rate = dailyRentRate(Number(t.rentAmount) || 0, t.rentFrequency);
      const daysBehind = Math.max(0, daysBetween(t.paidUpToDate, today));
      const unpaidInvoices = (invoices.data ?? [])
        .filter((i: any) => i.tenantId === t.id && i.status !== "Paid")
        .reduce((sum: number, i: any) => sum + (Number(i.amountDue) || 0), 0);
      return {
        tenant: t.name,
        propertyAddress: addressById.get(t.propertyId) ?? null,
        paidUpToDate: t.paidUpToDate,
        daysInArrears: daysBehind,
        rentOwing: Math.round(daysBehind * rate * 100) / 100,
        unpaidInvoices: Math.round(unpaidInvoices * 100) / 100,
        totalOwing: Math.round((daysBehind * rate + unpaidInvoices) * 100) / 100,
      };
    });
    const inArrears = rows.filter((r) => r.totalOwing > 0).sort((a, b) => b.totalOwing - a.totalOwing);
    return textResult({
      asOf: today,
      count: inArrears.length,
      totalOwing: Math.round(inArrears.reduce((s, r) => s + r.totalOwing, 0) * 100) / 100,
      tenants: inArrears,
    });
  },
});
