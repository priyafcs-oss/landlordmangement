import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveStoredBase64 } from "../_shared/storage.ts";

// Every table in the app's schema — see src/lib/db.ts's TABLES map, which this mirrors, plus
// app_settings (not in that map, has its own constant elsewhere in the client). Was missing
// loan_statements/bank_accounts/insurance_policies/maintenance_items/compliance_certificates/
// property_notes/provider_agreements/provider_properties/email_inbox_log until this list was
// reconciled against db.ts's TABLES map alongside the Storage migration below — this "complete"
// backup had silently been missing those tables' rows entirely.
const TABLES = [
  "properties",
  "tenants",
  "ledger_entries",
  "tenant_invoices",
  "loans",
  "expenses",
  "inspections",
  "rent_changes",
  "lease_history",
  "maintenance_requests",
  "property_bills",
  "ai_intake_proposals",
  "email_inbox_log",
  "providers",
  "provider_agreements",
  "provider_properties",
  "entities",
  "assets",
  "gold_details",
  "etf_details",
  "depreciation_items",
  "valuation_snapshots",
  "loan_balance_snapshots",
  "loan_statements",
  "buffers",
  "bank_accounts",
  "insurance_policies",
  "maintenance_items",
  "compliance_certificates",
  "property_notes",
  "provider_documents",
  "app_settings",
];

const FILE_DATA_KEY = /^(fileData|photoData|data)$/i;
const FILE_DATA_SUFFIX = /FileData$/;

function isFileDataKey(key: string): boolean {
  return FILE_DATA_KEY.test(key) || FILE_DATA_SUFFIX.test(key);
}

/**
 * Every file field used to hold base64 directly, making a data-only export self-contained by
 * construction. Since the Storage migration (../_shared/storage.ts, ../backfill-storage) those
 * fields hold "storage:<path>" markers instead — resolved back to base64 here so this export
 * stays a genuinely complete, standalone backup rather than a set of pointers into Storage that
 * outlive the rows referencing them.
 */
async function inlineStorageFiles(supabase: SupabaseClient, value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => inlineStorageFiles(supabase, v)));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (isFileDataKey(key) && typeof v === "string" && v.startsWith("storage:")) {
        out[key] = (await resolveStoredBase64(supabase, v)) ?? v;
      } else {
        out[key] = await inlineStorageFiles(supabase, v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Full-database JSON export for backup purposes. Runs as service_role (bypasses RLS) so it can
 * be called by an unauthenticated scheduled job (e.g. a GitHub Actions cron) rather than needing
 * a landlord login session. Gated by a shared secret, not by Supabase Auth, since a scheduler has
 * no user to sign in as.
 *
 * This captures every ROW, including every attachment (see inlineStorageFiles above) — a
 * data-only export is a genuinely complete backup. Schema (DDL) is not included here; it lives in
 * supabase/migrations/ in git and is the source of truth for reconstructing table structure
 * before replaying this data back in.
 */
Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("BACKUP_EXPORT_SECRET");
  if (!expectedSecret) {
    console.error("[export-backup] BACKUP_EXPORT_SECRET is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }
  const providedSecret = req.headers.get("x-backup-secret") ?? new URL(req.url).searchParams.get("secret");
  if (providedSecret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    tables: {} as Record<string, unknown[]>,
  };
  const tables = result.tables as Record<string, unknown[]>;
  const errors: Record<string, string> = {};

  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      errors[table] = error.message;
      tables[table] = [];
    } else {
      tables[table] = (await Promise.all((data ?? []).map((row) => inlineStorageFiles(supabase, row)))) as unknown[];
    }
  }

  if (Object.keys(errors).length > 0) {
    result.errors = errors;
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
