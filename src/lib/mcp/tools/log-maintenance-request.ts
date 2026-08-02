import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "log_maintenance_request",
  title: "Log a maintenance request",
  description: "Create a new maintenance request against a property in the portfolio.",
  inputSchema: {
    propertyId: z.string().trim().describe("Property id from list_properties."),
    description: z.string().trim().describe("What needs fixing."),
    category: z.string().trim().optional().describe("e.g. Plumbing, Electrical, Appliance, Other."),
    urgency: z.string().trim().optional().describe("e.g. Low, Medium, High, Emergency."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  needsApproval: true,
  handler: async ({ propertyId, description, category, urgency }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id,address")
      .eq("id", propertyId)
      .maybeSingle();
    if (propertyError) return errorResult(propertyError.message);
    if (!property) return errorResult(`No property found with id ${propertyId}`);

    const row = {
      id: "mr_" + Math.random().toString(36).slice(2, 10),
      propertyId,
      propertyAddressTyped: (property as any).address ?? "",
      category: category ?? "Other",
      description,
      urgency: urgency ?? "Medium",
      status: "Pending",
      createdAt: new Date().toISOString(),
      source: "mcp",
    };
    const { error } = await supabase.from("maintenance_requests").insert(row);
    if (error) return errorResult(error.message);
    return textResult({ created: row });
  },
});
