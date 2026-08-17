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
  providers: "providers",
  entities: "entities",
  assets: "assets",
  goldDetails: "gold_details",
  etfDetails: "etf_details",
  depreciationItems: "depreciation_items",
  valuationSnapshots: "valuation_snapshots",
  loanBalanceSnapshots: "loan_balance_snapshots",
  buffers: "buffers",
} as const;

export const SETTINGS_TABLE = "app_settings";
export const SETTINGS_ID = "singleton";

// The generated Database types are refreshed asynchronously by the platform,
// so we talk to PostgREST through a loosely typed handle.
const db = supabase as unknown as {
  from: (table: string) => any;
};

function report(context: string, error: unknown) {
  if (error) console.error(`[cloud] ${context}`, error);
}

export async function selectAll<T>(table: string): Promise<T[]> {
  const { data, error } = await db.from(table).select("*").order("created_at", { ascending: true });
  report(`select ${table}`, error);
  return (data ?? []) as T[];
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
  const { data, error } = await db.from(SETTINGS_TABLE).select("*").eq("id", SETTINGS_ID).maybeSingle();
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
  const { error } = await db.from(SETTINGS_TABLE).upsert({ id: SETTINGS_ID, ...patch, updated_at: new Date().toISOString() });
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
