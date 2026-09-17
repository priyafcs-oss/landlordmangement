import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mimeForFileName, uploadBase64ToStorage } from "../_shared/storage.ts";

/**
 * One-off migration: every file this app has EVER stored (before src/lib/db.ts's
 * migrateFileFieldsToStorage started intercepting new writes, and before ../parse-inbound-bill's
 * router.ts started uploading inbound attachments) is still sitting as base64 directly in these
 * tables' columns. That's the actual cause of the Supabase egress overage this migration fixes —
 * every one of these tables gets fetched in full on every app load (src/lib/store.tsx), so every
 * file's bytes were being re-downloaded on every single page view.
 *
 * Run once, manually, after deploying: `supabase functions deploy backfill-storage`, then
 * `curl -X POST https://<project>.functions.supabase.co/backfill-storage -H "x-backfill-secret: <BACKFILL_SECRET>"`.
 * Safe to re-run — migrateFileFieldsToStorage skips anything already "storage:"-prefixed, so a
 * partial/interrupted run just picks up where it left off.
 *
 * POST with `?report=1` instead runs no writes at all — it just sums the current size of every
 * object in the documents bucket, to answer "how much file data was getting re-downloaded on
 * every full portfolio load before this migration."
 */
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

function nameKeyCandidates(key: string): string[] {
  const candidates: string[] = [];
  if (FILE_DATA_SUFFIX.test(key)) candidates.push(key.replace(FILE_DATA_SUFFIX, "FileName"));
  if (/^photoData$/i.test(key)) candidates.push("photoName");
  if (/^data$/i.test(key)) candidates.push("name");
  candidates.push("fileName", "name");
  return candidates;
}

/** Same recursive scan as src/lib/db.ts's migrateFileFieldsToStorage, ported to run server-side
 * against every EXISTING row rather than only new writes — see that function's own comment for
 * why a single generic, name-pattern-based scan covers every table without per-table logic.
 * Returns null when nothing in this value needed migrating, so the caller can skip a no-op UPDATE. */
async function migrateValue(
  supabase: SupabaseClient,
  ownerId: string | null,
  value: unknown,
): Promise<{ changed: boolean; value: unknown }> {
  if (Array.isArray(value)) {
    let changed = false;
    const out = await Promise.all(
      value.map(async (v) => {
        const r = await migrateValue(supabase, ownerId, v);
        if (r.changed) changed = true;
        return r.value;
      }),
    );
    return { changed, value: out };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const [key, v] of Object.entries(obj)) {
      if (isFileDataKey(key) && typeof v === "string" && v.length > 0 && !v.startsWith("storage:")) {
        const nameKey = nameKeyCandidates(key).find((k) => typeof obj[k] === "string");
        const fileName = nameKey ? (obj[nameKey] as string) : undefined;
        out[key] = await uploadBase64ToStorage(supabase, v, fileName, ownerId, mimeForFileName(fileName));
        changed = true;
      } else {
        const r = await migrateValue(supabase, ownerId, v);
        out[key] = r.value;
        if (r.changed) changed = true;
      }
    }
    return { changed, value: out };
  }
  return { changed: false, value };
}

/** Recurses through every folder in the documents bucket, summing each object's byte size. */
async function totalBucketSize(supabase: SupabaseClient, prefix = ""): Promise<{ bytes: number; count: number }> {
  let bytes = 0;
  let count = 0;
  const { data: entries, error } = await supabase.storage.from("documents").list(prefix, { limit: 1000 });
  if (error || !entries) return { bytes, count };
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // A folder (Supabase Storage represents folders as entries with no id) — recurse into it.
      const sub = await totalBucketSize(supabase, path);
      bytes += sub.bytes;
      count += sub.count;
    } else {
      bytes += entry.metadata?.size ?? 0;
      count++;
    }
  }
  return { bytes, count };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("BACKFILL_SECRET");
  if (!expectedSecret) {
    console.error("[backfill-storage] BACKFILL_SECRET is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }
  const providedSecret = req.headers.get("x-backfill-secret") ?? new URL(req.url).searchParams.get("secret");
  if (providedSecret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (new URL(req.url).searchParams.get("report") === "1") {
    const { bytes, count } = await totalBucketSize(supabase);
    return new Response(JSON.stringify({ ok: true, totalBytes: bytes, totalMB: +(bytes / (1024 * 1024)).toFixed(2), fileCount: count }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const summary: Record<string, { scanned: number; migrated: number; errors: string[] }> = {};

  // A table carrying a lot of base64 (ai_intake_proposals especially — the whole email-intake
  // pipeline's staging table) can be too large for a single `select("*")` to finish inside
  // Postgres's statement_timeout. Paging through it with `.range()` keeps each individual query
  // small regardless of total table size; ordering by id keeps pages stable since rows are only
  // updated in place here, never inserted/deleted mid-run.
  const PAGE_SIZE = 20;
  // Every table is keyed by "id" except these two, which are keyed by the asset row they extend
  // (see src/lib/store.tsx's addAssetDetails: `upsertRow(TABLES.goldDetails, { assetId: id, ... })`).
  const PRIMARY_KEY: Record<string, string> = { gold_details: "assetId", etf_details: "assetId" };

  for (const table of TABLES) {
    summary[table] = { scanned: 0, migrated: 0, errors: [] };
    const pk = PRIMARY_KEY[table] ?? "id";
    let offset = 0;
    for (;;) {
      const { data: rows, error } = await supabase
        .from(table)
        .select("*")
        .order(pk, { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        summary[table].errors.push(`offset ${offset}: ${error.message}`);
        break;
      }
      for (const row of rows ?? []) {
        summary[table].scanned++;
        const r = row as Record<string, unknown>;
        const ownerId = typeof r.owner_id === "string" ? r.owner_id : null;
        const id = r[pk];
        const { changed, value } = await migrateValue(supabase, ownerId, r);
        if (!changed) continue;
        const updated = value as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(updated)) {
          if (updated[key] !== r[key]) patch[key] = updated[key];
        }
        const { error: updateError } = await supabase.from(table).update(patch).eq(pk, id);
        if (updateError) {
          summary[table].errors.push(`${id}: ${updateError.message}`);
        } else {
          summary[table].migrated++;
        }
      }
      if (!rows || rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  return new Response(JSON.stringify({ ok: true, summary }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
