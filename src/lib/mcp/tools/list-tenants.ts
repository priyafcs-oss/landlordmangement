import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_tenants",
  title: "List tenants",
  description:
    "List tenants with their linked property, rent amount and frequency, lease start/expiry and paid-up-to date.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const [tenants, properties] = await Promise.all([
      supabase.from("tenants").select("*"),
      supabase.from("properties").select("id,address"),
    ]);
    if (tenants.error) return errorResult(tenants.error.message);
    if (properties.error) return errorResult(properties.error.message);
    const addressById = new Map((properties.data ?? []).map((p: any) => [p.id, p.address]));
    const rows = (tenants.data ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      email: t.email ?? null,
      phone: t.phone ?? null,
      propertyAddress: addressById.get(t.propertyId) ?? null,
      rentAmount: t.rentAmount,
      rentFrequency: t.rentFrequency,
      leaseStart: t.leaseStart ?? null,
      leaseExpiry: t.leaseExpiry ?? null,
      paidUpToDate: t.paidUpToDate,
      bondAmount: t.bondAmount ?? null,
    }));
    return textResult({ count: rows.length, tenants: rows });
  },
});
