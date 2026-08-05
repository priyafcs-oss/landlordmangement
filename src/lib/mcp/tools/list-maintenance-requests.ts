import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_maintenance_requests",
  title: "List maintenance requests",
  description: "List tenant-submitted and landlord-logged maintenance requests, optionally filtered by status.",
  inputSchema: {
    status: z.string().trim().optional().describe("Optional status filter, e.g. Pending, In Progress, Completed."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let query = supabaseForUser(ctx).from("maintenance_requests").select("*");
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, requests: data ?? [] });
  },
});
