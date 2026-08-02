import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProperties from "./tools/list-properties";
import listTenants from "./tools/list-tenants";
import listArrears from "./tools/list-arrears";
import portfolioSummary from "./tools/portfolio-summary";
import listExpenses from "./tools/list-expenses";
import listMaintenanceRequests from "./tools/list-maintenance-requests";
import logMaintenanceRequest from "./tools/log-maintenance-request";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "landlord-s-compass",
  title: "Landlord's Compass",
  version: "0.1.0",
  instructions:
    "Tools for Landlord's Compass, an Australian property management and accounting app. Use portfolio_summary for wealth and cash-flow totals, list_properties and list_tenants for portfolio structure, list_arrears to find tenants behind on rent, list_expenses for tax/EOFY reporting by Australian financial year, and the maintenance tools to review or log repair jobs. All data belongs to the signed-in landlord.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    portfolioSummary,
    listProperties,
    listTenants,
    listArrears,
    listExpenses,
    listMaintenanceRequests,
    logMaintenanceRequest,
  ],
});
