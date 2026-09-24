import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveStoredBase64 } from "../_shared/storage.ts";
import { downloadBytesFromDrive, driveFileId, getAccessTokenForOwner, isGoogleDrivePath } from "../_shared/googleDrive.ts";

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Every file field used to hold base64 directly, making a data-only export self-contained by
 * construction. Since the Storage migration (../_shared/storage.ts, ../backfill-storage) those
 * fields hold "storage:<path>" markers instead — resolved back to base64 here with the
 * service-role key (works because service_role bypasses the bucket's owner-scoped Storage RLS).
 * Since the Google Drive migration, a field can also hold a "gdrive:<fileId>" marker pointing at
 * ONE SPECIFIC LANDLORD's own personal Drive — service_role has no access to that at all, so
 * those need the OWNING row's own Drive refresh token (admin_get_google_drive_refresh_token),
 * looked up via ownerId (the exporting row's own owner_id — every table has one) rather than a
 * single global resolve pass. getAccessTokenForOwner caches per owner internally, so this stays
 * cheap even with many rows sharing the same owner.
 */
async function inlineStorageFiles(supabase: SupabaseClient, value: unknown, ownerId: string | null): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => inlineStorageFiles(supabase, v, ownerId)));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (isFileDataKey(key) && typeof v === "string" && v.startsWith("storage:")) {
        out[key] = (await resolveStoredBase64(supabase, v)) ?? v;
      } else if (isFileDataKey(key) && typeof v === "string" && isGoogleDrivePath(v)) {
        const token = await getAccessTokenForOwner(supabase, ownerId, "admin");
        const downloaded = token ? await downloadBytesFromDrive(token.accessToken, driveFileId(v)) : null;
        out[key] = downloaded ? bytesToBase64(downloaded.bytes) : v;
      } else {
        out[key] = await inlineStorageFiles(supabase, v, ownerId);
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
      tables[table] = (await Promise.all(
        (data ?? []).map((row) => inlineStorageFiles(supabase, row, (row as { owner_id?: string }).owner_id ?? null)),
      )) as unknown[];
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
