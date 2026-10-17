import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mimeForFileName } from "./storage.ts";
import { GDRIVE_PREFIX, uploadBytesToDrive } from "./googleDrive.ts";
import { FILE_TABLES } from "./driveOrganize.ts";

/**
 * Moves an owner's "storage:<path>" files (the shared Supabase `documents` bucket) into their own
 * Google Drive, rewriting each field to a "gdrive:<fileId>" marker. Used by Settings' "Move to
 * Drive & organise" button (drive-organize, with the caller's own session client, so RLS scopes
 * every read and write to their portfolio) and by the admin migrate-storage-to-drive tool.
 *
 * Never drops a file: a failed upload leaves the original storage: marker in place, and the
 * Storage object itself is never deleted. Safe to re-run — only still-"storage:" fields are
 * touched, and a copy uploaded by an earlier, cut-off run is found by its source tag and reused.
 */
const TABLES = FILE_TABLES;

export const DOCUMENTS_BUCKET = "documents";
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
export function remapDriveMarkers(value: unknown, remap: Map<string, string>, referenced: Set<string>): { changed: boolean; value: unknown } {
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

const PAGE_SIZE = 20;
const PRIMARY_KEY: Record<string, string> = { gold_details: "assetId", etf_details: "assetId" };

type TableSummary = { scanned: number; updated: number; errors: string[] };

/** Walks every one of the owner's rows across TABLES, writing back only the columns `transform`
 * actually changed (it must return the original reference for an unchanged column). With
 * `apply` false, counts what it would update without writing anything. */
export async function rewriteOwnerRows(
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


export interface MoveToDriveResult {
  /** Distinct Storage files now in Drive. */
  filesMoved: number;
  rowsUpdated: number;
  /** Storage files that couldn't be moved (left on their storage: marker). */
  filesFailed: number;
  errors: string[];
}

export async function moveStorageFilesToDrive(
  supabase: SupabaseClient,
  ownerId: string,
  accessToken: string,
  rootFolderId: string,
): Promise<MoveToDriveResult> {
  const ctx: MigrateContext = { supabase, accessToken, rootFolderId, uploads: new Map() };
  const summary = await rewriteOwnerRows(supabase, ownerId, (row) => migrateValue(ctx, row));
  const outcomes = await Promise.all(ctx.uploads.values());
  return {
    filesMoved: outcomes.filter((m) => m !== null).length,
    filesFailed: outcomes.filter((m) => m === null).length,
    rowsUpdated: Object.values(summary).reduce((n, t) => n + t.updated, 0),
    errors: Object.entries(summary).flatMap(([table, t]) => t.errors.map((e) => `${table} ${e}`)),
  };
}
