import { supabase } from "@/integrations/supabase/client";
import { uploadDocumentBase64 } from "./files";

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

/**
 * Every file this app stores — property photos/videos, lease/compliance/loan documents, bill and
 * expense receipts — has always followed one of two shapes: a top-level `xFileData`/`fileData`/
 * `photoData` string, or an array of `{name, data}`/`{fileName, fileData}` objects (photos,
 * videos, attachments). Both shapes are consistent enough across every table (see CLAUDE.md /
 * types.ts) that a single generic, name-pattern-based scan can find and offload every one of
 * them to Storage here, in the ONE place every write already passes through — instead of teaching
 * ~20 separate upload dialogs about Storage individually. See src/lib/files.ts for the actual
 * upload/resolve implementation and why fields keep their existing names/types (just swapping
 * base64 content for a "storage:<path>" marker) rather than being renamed.
 */
const FILE_DATA_KEY = /^(fileData|photoData|data)$/i;
const FILE_DATA_SUFFIX = /FileData$/;

function isFileDataKey(key: string): boolean {
  return FILE_DATA_KEY.test(key) || FILE_DATA_SUFFIX.test(key);
}

/** Candidate sibling keys (checked in order) that would hold this file's display name, given the
 * pattern's own key — e.g. "sourceFileData" -> "sourceFileName", "data" -> "name". */
function nameKeyCandidates(key: string): string[] {
  const candidates: string[] = [];
  if (FILE_DATA_SUFFIX.test(key)) candidates.push(key.replace(FILE_DATA_SUFFIX, "FileName"));
  if (/^photoData$/i.test(key)) candidates.push("photoName");
  if (/^data$/i.test(key)) candidates.push("name");
  candidates.push("fileName", "name");
  return candidates;
}

async function migrateFileFieldsToStorage(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => migrateFileFieldsToStorage(v)));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (isFileDataKey(key) && typeof v === "string" && v.length > 0 && !v.startsWith("storage:")) {
        const nameKey = nameKeyCandidates(key).find((k) => typeof obj[k] === "string");
        const fileName = nameKey ? (obj[nameKey] as string) : undefined;
        out[key] = await uploadDocumentBase64(v, fileName);
      } else {
        out[key] = await migrateFileFieldsToStorage(v);
      }
    }
    return out;
  }
  return value;
}

export async function upsertRow(table: string, row: Record<string, unknown>) {
  const processed = (await migrateFileFieldsToStorage(row)) as Record<string, unknown>;
  const { error } = await db.from(table).upsert(stripUndefined(processed));
  report(`upsert ${table}`, error);
}

export async function updateRow(table: string, id: string, patch: Record<string, unknown>) {
  const processed = (await migrateFileFieldsToStorage(patch)) as Record<string, unknown>;
  const { error } = await db.from(table).update(stripUndefined(processed)).eq("id", id);
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
