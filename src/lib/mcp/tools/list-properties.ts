import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_properties",
  title: "List properties",
  description:
    "List every property in the portfolio with address, purchase price, current market value, lender and loan balance.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const { data, error } = await supabaseForUser(ctx).from("properties").select("*");
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, properties: data ?? [] });
  },
});
