import { createClient } from "npm:@supabase/supabase-js@2";

// Every table in the app's schema — see src/lib/db.ts's TABLES map, which this mirrors, plus
// app_settings (not in that map, has its own constant elsewhere in the client).
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
  "app_settings",
];

/**
 * Full-database JSON export for backup purposes. Runs as service_role (bypasses RLS) so it can
 * be called by an unauthenticated scheduled job (e.g. a GitHub Actions cron) rather than needing
 * a landlord login session. Gated by a shared secret, not by Supabase Auth, since a scheduler has
 * no user to sign in as.
 *
 * This captures every ROW — including attachments, which this app stores as base64 directly in
 * Postgres columns rather than in object storage, so a data-only export is a genuinely complete
 * backup. Schema (DDL) is not included here; it lives in supabase/migrations/ in git and is the
 * source of truth for reconstructing table structure before replaying this data back in.
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
      tables[table] = data ?? [];
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
