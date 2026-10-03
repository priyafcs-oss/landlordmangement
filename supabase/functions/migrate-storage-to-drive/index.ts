import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mimeForFileName } from "../_shared/storage.ts";
import { type DriveItem, GDRIVE_PREFIX, getAccessTokenForOwner, listDriveTree, uploadBytesToDrive } from "../_shared/googleDrive.ts";
import { FILE_TABLES, organizeDrive } from "../_shared/driveOrganize.ts";

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
 * `?dedupe=1` and `?organize=1` are follow-up passes over the migrated Drive files — see
 * dedupeDrive below and ../_shared/driveOrganize.ts.
 */
const TABLES = FILE_TABLES;

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

/** Drive appProperties cap key+value at 124 bytes, which a full "<uid>/<uuid>-<name>" path can
 * exceed — so each upload is tagged with a hash of its source path instead. */
const SOURCE_PROPERTY = "lsrc";

async function sourcePathTag(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function findDriveFileBySourceTag(accessToken: string, tag: string): Promise<string | null> {
  const q = encodeURIComponent(`trashed=false and appProperties has { key='${SOURCE_PROPERTY}' and value='${tag}' }`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id ? GDRIVE_PREFIX + data.files[0].id : null;
}

interface MigrateContext {
  supabase: SupabaseClient;
  accessToken: string;
  rootFolderId: string;
  /** One Drive upload per Storage object per run — many rows share one object (an AI intake
   * proposal and the expense it created both point at the same upload), and uploading each
   * reference separately is what produced duplicate Drive files on the first migration. Holds the
   * Promise itself so concurrent array elements referencing the same path share one upload. */
  uploads: Map<string, Promise<string | null>>;
}

/** Reuses an earlier run's copy (found by its source tag) before uploading — a run cut off by
 * the edge function time limit can leave an uploaded file whose row update never landed. */
function migrateStoragePath(ctx: MigrateContext, path: string, fileName: string | undefined): Promise<string | null> {
  let pending = ctx.uploads.get(path);
  if (!pending) {
    pending = (async () => {
      const tag = await sourcePathTag(path);
      const existing = await findDriveFileBySourceTag(ctx.accessToken, tag);
      if (existing) return existing;
      const downloaded = await downloadFromBucket(ctx.supabase, path);
      if (!downloaded) return null;
      return uploadBytesToDrive(ctx.accessToken, ctx.rootFolderId, downloaded.bytes, fileName || "file", downloaded.contentType || mimeForFileName(fileName), {
        [SOURCE_PROPERTY]: tag,
      });
    })();
    ctx.uploads.set(path, pending);
  }
  return pending;
}

/** Same recursive shape as backfill-storage's migrateValue, but only ever touches an already-
 * "storage:"-prefixed field (a not-yet-backfilled raw-base64 field isn't this function's job —
 * that's backfill-storage's own, separate, one-time job) and moves it into the given owner's
 * Drive instead of the shared bucket. Returns the original reference for anything unchanged. */
async function migrateValue(ctx: MigrateContext, value: unknown): Promise<{ changed: boolean; value: unknown }> {
  if (Array.isArray(value)) {
    const results = await Promise.all(value.map((v) => migrateValue(ctx, v)));
    const changed = results.some((r) => r.changed);
    return { changed, value: changed ? results.map((r) => r.value) : value };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const [key, v] of Object.entries(obj)) {
      if (isFileDataKey(key) && typeof v === "string" && v.startsWith(STORAGE_PREFIX)) {
        const nameKey = nameKeyCandidates(key).find((k) => typeof obj[k] === "string");
        const fileName = nameKey ? (obj[nameKey] as string) : undefined;
        const marker = await migrateStoragePath(ctx, v.slice(STORAGE_PREFIX.length), fileName);
        out[key] = marker ?? v; // keep the original storage: marker on any failure — never drop the file
        if (marker !== null) changed = true; // never reset — an earlier key in this object may already have changed
      } else {
        const r = await migrateValue(ctx, v);
        out[key] = r.value;
        if (r.changed) changed = true;
      }
    }
    return { changed, value: changed ? out : value };
  }
  return { changed: false, value };
}

/** Rewrites every "gdrive:<id>" string anywhere in a value through `remap`, and records every
 * marker the result still references into `referenced`. Returns the original reference for
 * anything unchanged. */
function remapDriveMarkers(value: unknown, remap: Map<string, string>, referenced: Set<string>): { changed: boolean; value: unknown } {
  if (typeof value === "string") {
    if (!value.startsWith(GDRIVE_PREFIX)) return { changed: false, value };
    const next = remap.get(value) ?? value;
    referenced.add(next);
    return { changed: next !== value, value: next };
  }
  if (Array.isArray(value)) {
    const results = value.map((v) => remapDriveMarkers(v, remap, referenced));
    const changed = results.some((r) => r.changed);
    return { changed, value: changed ? results.map((r) => r.value) : value };
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const r = remapDriveMarkers(v, remap, referenced);
      out[key] = r.value;
      if (r.changed) changed = true;
    }
    return { changed, value: changed ? out : value };
  }
  return { changed: false, value };
}

/** Moves to Drive's trash rather than deleting outright — recoverable for 30 days. */
async function trashDriveFile(accessToken: string, fileId: string): Promise<boolean> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  return res.ok;
}

const PAGE_SIZE = 20;
const PRIMARY_KEY: Record<string, string> = { gold_details: "assetId", etf_details: "assetId" };

type TableSummary = { scanned: number; updated: number; errors: string[] };

/** Walks every one of the owner's rows across TABLES, writing back only the columns `transform`
 * actually changed (it must return the original reference for an unchanged column). With
 * `apply` false, counts what it would update without writing anything. */
async function rewriteOwnerRows(
  supabase: SupabaseClient,
  ownerId: string,
  transform: (row: Record<string, unknown>) => Promise<{ changed: boolean; value: unknown }>,
  apply = true,
): Promise<Record<string, TableSummary>> {
  const summary: Record<string, TableSummary> = {};
  for (const table of TABLES) {
    summary[table] = { scanned: 0, updated: 0, errors: [] };
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
        const { changed, value } = await transform(r);
        if (!changed) continue;
        if (!apply) {
          summary[table].updated++;
          continue;
        }
        const updated = value as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(updated)) {
          if (updated[key] !== r[key]) patch[key] = updated[key];
        }
        const { error: updateError } = await supabase.from(table).update(patch).eq(pk, r[pk]);
        if (updateError) {
          summary[table].errors.push(`${r[pk]}: ${updateError.message}`);
        } else {
          summary[table].updated++;
        }
      }
      if (!rows || rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  return summary;
}

/**
 * `?dedupe=1`: collapses byte-identical Drive copies (same md5) onto the oldest one, repoints
 * every row at it, then trashes any file in the owner's root folder that no row references any
 * more (the collapsed duplicates, plus uploads orphaned by a timed-out migration run). Dry run
 * unless `&apply=1`. Sharing one Drive file across rows is safe — nothing in this app ever
 * deletes a Drive file when a row is removed, the same as the shared-path Storage it replaced.
 */
async function dedupeDrive(supabase: SupabaseClient, ownerId: string, accessToken: string, rootFolderId: string, apply: boolean) {
  const tree = await listDriveTree(accessToken, rootFolderId);
  if (!tree) return { ok: false, error: "Couldn't list the owner's Drive folder" };
  const files = tree.files;

  const byChecksum = new Map<string, DriveItem[]>();
  for (const f of files) {
    if (!f.md5Checksum) continue;
    const group = byChecksum.get(f.md5Checksum) ?? [];
    group.push(f);
    byChecksum.set(f.md5Checksum, group);
  }
  const remap = new Map<string, string>();
  for (const group of byChecksum.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));
    for (const dup of group.slice(1)) remap.set(GDRIVE_PREFIX + dup.id, GDRIVE_PREFIX + group[0].id);
  }

  const referenced = new Set<string>();
  const summary = await rewriteOwnerRows(supabase, ownerId, async (row) => remapDriveMarkers(row, remap, referenced), apply);

  // An incomplete scan means an incomplete `referenced` set — trashing against it could orphan a
  // file a row still needs, so stop before touching Drive at all.
  const scanErrors = Object.values(summary).flatMap((s) => s.errors);
  const unreferenced = files.filter((f) => !referenced.has(GDRIVE_PREFIX + f.id));
  let trashed = 0;
  if (apply && scanErrors.length === 0) {
    for (const f of unreferenced) {
      if (await trashDriveFile(accessToken, f.id)) trashed++;
    }
  }

  return {
    ok: scanErrors.length === 0,
    apply,
    driveFiles: files.length,
    duplicateCopies: remap.size,
    rowsRepointed: Object.values(summary).reduce((n, s) => n + s.updated, 0),
    referencedAfter: referenced.size,
    unreferenced: unreferenced.length,
    unreferencedMB: +(unreferenced.reduce((n, f) => n + Number(f.size ?? 0), 0) / (1024 * 1024)).toFixed(2),
    trashed,
    errors: scanErrors,
  };
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
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
    return json({ error: "?ownerId=<uuid> query param is required" }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (url.searchParams.get("report") === "1") {
    const { bytes, count } = await ownerBucketSize(supabase, ownerId);
    return json({ ok: true, ownerId, totalBytes: bytes, totalMB: +(bytes / (1024 * 1024)).toFixed(2), fileCount: count });
  }

  const token = await getAccessTokenForOwner(supabase, ownerId, "admin");
  if (!token) {
    return json({ error: "This owner hasn't connected Google Drive yet — connect it in Settings first" }, 400);
  }

  if (url.searchParams.get("organize") === "1") {
    const result = await organizeDrive(supabase, ownerId, token.accessToken, token.rootFolderId);
    return json({ ownerId, ...result }, result.ok ? 200 : 500);
  }

  if (url.searchParams.get("dedupe") === "1") {
    const result = await dedupeDrive(supabase, ownerId, token.accessToken, token.rootFolderId, url.searchParams.get("apply") === "1");
    return json({ ownerId, ...result }, result.ok ? 200 : 500);
  }

  const ctx: MigrateContext = { supabase, accessToken: token.accessToken, rootFolderId: token.rootFolderId, uploads: new Map() };
  const summary = await rewriteOwnerRows(supabase, ownerId, (row) => migrateValue(ctx, row));
  return json({ ok: true, ownerId, summary });
});
