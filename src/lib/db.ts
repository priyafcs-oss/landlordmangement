import { supabase } from "@/integrations/supabase/client";

/** Table names in the cloud database, keyed by the in-app collection name. */
export const TABLES = {
  properties: "properties",
  tenants: "tenants",
  ledger: "ledger_entries",
  invoices: "tenant_invoices",
  loans: "loans",
  expenses: "expenses",
  inspections: "inspections",
  rentChanges: "rent_changes",
  leaseHistory: "lease_history",
  maintenanceRequests: "maintenance_requests",
  bills: "property_bills",
  aiProposals: "ai_intake_proposals",
  emailInboxLog: "email_inbox_log",
  providers: "providers",
  providerAgreements: "provider_agreements",
  providerProperties: "provider_properties",
  entities: "entities",
  assets: "assets",
  goldDetails: "gold_details",
  etfDetails: "etf_details",
  depreciationItems: "depreciation_items",
  valuationSnapshots: "valuation_snapshots",
  loanBalanceSnapshots: "loan_balance_snapshots",
  loanStatements: "loan_statements",
  buffers: "buffers",
  bankAccounts: "bank_accounts",
  insurancePolicies: "insurance_policies",
  maintenanceItems: "maintenance_items",
  complianceCertificates: "compliance_certificates",
  propertyNotes: "property_notes",
  providerDocuments: "provider_documents",
} as const;

export const SETTINGS_TABLE = "app_settings";

// The generated Database types are refreshed asynchronously by the platform,
// so we talk to PostgREST through a loosely typed handle.
const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
};

/** Each user's settings row is keyed by their effective owner id now that the app is multi-tenant
 * — there's no longer a single global "singleton" row (see
 * 20260913100000_multi_tenant_owner_scoping.sql). Usually that's just the signed-in user's own id,
 * but an aliased account (see 20260913120000_owner_aliases_and_shared_access.sql — e.g. two people
 * sharing one portfolio from before multi-tenancy existed) resolves to the canonical owner's id
 * instead, so both land on the same settings row. */
async function effectiveOwnerId(): Promise<string | null> {
  const { data, error } = await db.rpc("effective_owner_id");
  report("resolve effective owner id", error);
  return (data as string | null) ?? null;
}

function report(context: string, error: unknown) {
  if (error) console.error(`[cloud] ${context}`, error);
}

export async function selectAll<T>(table: string): Promise<T[]> {
  const { data, error } = await db.from(table).select("*").order("created_at", { ascending: true });
  report(`select ${table}`, error);
  return (data ?? []) as T[];
}

/** Fetches a single row by id — for refreshing local state after an action that's known to have
 * touched exactly one row, instead of re-pulling every table via `selectAll`. */
export async function selectOne<T>(table: string, id: string): Promise<T | null> {
  const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
  report(`select ${table} by id`, error);
  return (data ?? null) as T | null;
}

export interface PublicProperty {
  id: string;
  address: string;
  alias: string | null;
  tenantCode: string | null;
}

/**
 * Minimal, anonymous-readable property lookup for the public maintenance-request form — only
 * the columns needed to match a typed address/tenant-code to a property id. Deliberately not
 * `selectAll`: that pulls every column (purchase price, loan balance, etc.) from the full
 * `properties` table, which anon can no longer read since Phase 1 auth was added.
 */
export async function selectPublicProperties(): Promise<PublicProperty[]> {
  const { data, error } = await db.from("properties_public").select("*");
  report("select properties_public", error);
  return (data ?? []) as PublicProperty[];
}

export async function upsertRow(table: string, row: Record<string, unknown>) {
  const { error } = await db.from(table).upsert(stripUndefined(row));
  report(`upsert ${table}`, error);
}

export async function updateRow(table: string, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from(table).update(stripUndefined(patch)).eq("id", id);
  report(`update ${table}`, error);
}

export async function deleteRow(table: string, id: string) {
  const { error } = await db.from(table).delete().eq("id", id);
  report(`delete ${table}`, error);
}

export async function deleteWhere(table: string, column: string, value: string) {
  const { error } = await db.from(table).delete().eq(column, value);
  report(`delete ${table} by ${column}`, error);
}

export async function deleteWhereIn(table: string, column: string, values: string[]) {
  if (values.length === 0) return;
  const { error } = await db.from(table).delete().in(column, values);
  report(`delete ${table} by ${column} in`, error);
}

export async function loadSettings() {
  // RLS alone scopes this to exactly the caller's one row — no need to filter by id/owner_id
  // explicitly, which matters for an aliased account whose own id isn't what the row is keyed by.
  const { data, error } = await db.from(SETTINGS_TABLE).select("*").maybeSingle();
  report("load settings", error);
  return data as {
    aiConfig?: unknown;
    landlordProfile?: unknown;
    leaseTemplate?: unknown;
    tenantInfoStatement?: unknown;
    reportHistory?: unknown;
  } | null;
}

export async function saveSettings(patch: Record<string, unknown>) {
  const ownerId = await effectiveOwnerId();
  if (!ownerId) return;
  const { error } = await db
    .from(SETTINGS_TABLE)
    .upsert({ id: ownerId, owner_id: ownerId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
  report("save settings", error);
}

/** Strips undefined values and the server-managed created_at column. */
function stripUndefined(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || k === "created_at") continue;
    out[k] = v;
  }
  return out;
}
