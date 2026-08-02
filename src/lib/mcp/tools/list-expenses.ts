import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fyRange } from "@/lib/calculations";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_expenses",
  title: "List expenses",
  description:
    "List logged property expenses, optionally filtered by Australian financial year (e.g. 2025-2026) and property id. Includes ATO tax category totals.",
  inputSchema: {
    financialYear: z.string().trim().optional().describe("Australian financial year, e.g. 2025-2026."),
    propertyId: z.string().trim().optional().describe("Property id from list_properties."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ financialYear, propertyId }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let query = supabaseForUser(ctx).from("expenses").select("*");
    if (propertyId) query = query.eq("propertyId", propertyId);
    const { data, error } = await query;
    if (error) return errorResult(error.message);

    let rows = data ?? [];
    if (financialYear) {
      let range: { start: string; end: string };
      try {
        range = fyRange(financialYear);
      } catch {
        return errorResult(`Could not parse financial year "${financialYear}". Use the form 2025-2026.`);
      }
      rows = rows.filter((e: any) => e.date >= range.start && e.date <= range.end);
    }

    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const e of rows as any[]) {
      const cost = Number(e.cost) || 0;
      total += cost;
      const key = e.taxCategory || "Uncategorised";
      byCategory[key] = (byCategory[key] ?? 0) + cost;
    }
    return textResult({ count: rows.length, total, byTaxCategory: byCategory, expenses: rows });
  },
});
