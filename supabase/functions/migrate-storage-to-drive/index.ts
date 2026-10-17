import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type DriveItem, GDRIVE_PREFIX, getAccessTokenForOwner, listDriveTree, trashDriveItem } from "../_shared/googleDrive.ts";
import { organizeDrive } from "../_shared/driveOrganize.ts";
import { DOCUMENTS_BUCKET, moveStorageFilesToDrive, remapDriveMarkers, rewriteOwnerRows } from "../_shared/storageToDrive.ts";

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
 * dedupeDrive below and ../_shared/driveOrganize.ts. The move itself is
 * ../_shared/storageToDrive.ts, shared with Settings' "Move to Drive & organise" button.
 */

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
      if (await trashDriveItem(accessToken, f.id)) trashed++;
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

  const result = await moveStorageFilesToDrive(supabase, ownerId, token.accessToken, token.rootFolderId);
  return json({ ok: result.errors.length === 0, ownerId, ...result });
});
