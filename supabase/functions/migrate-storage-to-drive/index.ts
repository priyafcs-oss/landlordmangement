import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mimeForFileName } from "../_shared/storage.ts";
import { getAccessTokenForOwner, uploadBytesToDrive } from "../_shared/googleDrive.ts";

/**
 * One-off, per-owner migration: moves everything a single connected landlord still has in the
 * shared Supabase `documents` bucket ("storage:<path>" markers) into THEIR OWN Google Drive,
 * rewriting each field to a "gdrive:<fileId>" marker. Adapted from ../backfill-storage, which did
 * the equivalent base64 -> Storage move; this is Storage -> Drive, scoped to one owner at a time
 * since (unlike the old shared bucket) there's no single destination to migrate everyone into.
 *
 * Requires the owner to have already connected Google Drive (Settings -> "Connect Google Drive")
 * — 400s otherwise, so this can never run ahead of that step. Does NOT delete the original
 * Supabase Storage objects (matches this app's existing no-deletion precedent) — safe to re-run,
 * since only still-"storage:"-prefixed fields get touched.
 *
 * Run via: `curl -X POST "https://<project>.functions.supabase.co/migrate-storage-to-drive?ownerId=<uuid>" -H "x-migrate-secret: <DRIVE_MIGRATE_SECRET>"`.
 * `?report=1&ownerId=<uuid>` instead just sums that owner's remaining Supabase Storage footprint,
 * with no writes — use it to confirm nothing is left before retiring the bucket for good.
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

const DOCUMENTS_BUCKET = "documents";
const STORAGE_PREFIX = "storage:";
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

async function downloadFromBucket(supabase: SupabaseClient, path: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "" };
}

/** Same recursive shape as backfill-storage's migrateValue, but only ever touches an already-
 * "storage:"-prefixed field (a not-yet-backfilled raw-base64 field isn't this function's job —
 * that's backfill-storage's own, separate, one-time job) and moves it into the given owner's
 * Drive instead of the shared bucket. */
async function migrateValue(
  supabase: SupabaseClient,
  accessToken: string,
  rootFolderId: string,
  value: unknown,
): Promise<{ changed: boolean; value: unknown }> {
  if (Array.isArray(value)) {
    let changed = false;
    const out = await Promise.all(
      value.map(async (v) => {
        const r = await migrateValue(supabase, accessToken, rootFolderId, v);
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
      if (isFileDataKey(key) && typeof v === "string" && v.startsWith(STORAGE_PREFIX)) {
        const nameKey = nameKeyCandidates(key).find((k) => typeof obj[k] === "string");
        const fileName = nameKey ? (obj[nameKey] as string) : undefined;
        const downloaded = await downloadFromBucket(supabase, v.slice(STORAGE_PREFIX.length));
        const marker = downloaded
          ? await uploadBytesToDrive(accessToken, rootFolderId, downloaded.bytes, fileName || "file", downloaded.contentType || mimeForFileName(fileName))
          : null;
        out[key] = marker ?? v; // keep the original storage: marker on any failure — never drop the file
        changed = marker !== null;
      } else {
        const r = await migrateValue(supabase, accessToken, rootFolderId, v);
        out[key] = r.value;
        if (r.changed) changed = true;
      }
    }
    return { changed, value: out };
  }
  return { changed: false, value };
}

async function ownerBucketSize(supabase: SupabaseClient, ownerId: string): Promise<{ bytes: number; count: number }> {
  let bytes = 0;
  let count = 0;
  let offset = 0;
  for (;;) {
    const { data: entries, error } = await supabase.storage.from(DOCUMENTS_BUCKET).list(ownerId, { limit: 1000, offset });
    if (error || !entries) break;
    for (const entry of entries) {
      bytes += entry.metadata?.size ?? 0;
      count++;
    }
    if (entries.length < 1000) break;
    offset += 1000;
  }
  return { bytes, count };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("DRIVE_MIGRATE_SECRET");
  if (!expectedSecret) {
    console.error("[migrate-storage-to-drive] DRIVE_MIGRATE_SECRET is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }
  const providedSecret = req.headers.get("x-migrate-secret") ?? new URL(req.url).searchParams.get("secret");
  if (providedSecret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const ownerId = url.searchParams.get("ownerId");
  if (!ownerId) {
    return new Response(JSON.stringify({ error: "?ownerId=<uuid> query param is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (url.searchParams.get("report") === "1") {
    const { bytes, count } = await ownerBucketSize(supabase, ownerId);
    return new Response(JSON.stringify({ ok: true, ownerId, totalBytes: bytes, totalMB: +(bytes / (1024 * 1024)).toFixed(2), fileCount: count }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = await getAccessTokenForOwner(supabase, ownerId, "admin");
  if (!token) {
    return new Response(JSON.stringify({ error: "This owner hasn't connected Google Drive yet — connect it in Settings first" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const summary: Record<string, { scanned: number; migrated: number; errors: string[] }> = {};
  const PAGE_SIZE = 20;
  const PRIMARY_KEY: Record<string, string> = { gold_details: "assetId", etf_details: "assetId" };

  for (const table of TABLES) {
    summary[table] = { scanned: 0, migrated: 0, errors: [] };
    const pk = PRIMARY_KEY[table] ?? "id";
    let offset = 0;
    for (;;) {
      const { data: rows, error } = await supabase
        .from(table)
        .select("*")
        .eq("owner_id", ownerId)
        .order(pk, { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        summary[table].errors.push(`offset ${offset}: ${error.message}`);
        break;
      }
      for (const row of rows ?? []) {
        summary[table].scanned++;
        const r = row as Record<string, unknown>;
        const id = r[pk];
        const { changed, value } = await migrateValue(supabase, token.accessToken, token.rootFolderId, r);
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

  return new Response(JSON.stringify({ ok: true, ownerId, summary }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
