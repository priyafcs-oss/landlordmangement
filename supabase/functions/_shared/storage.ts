import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Server-side counterpart to src/lib/files.ts's Storage helpers — every inbound document (an
 * emailed bill, an in-app "Upload document" drop, a re-parse) used to get inserted into
 * `ai_intake_proposals` with its base64 content inlined directly in `sourceFileData` (see every
 * parse-*.ts file in ../parse-inbound-bill), which is exactly the pattern that drove the Supabase
 * egress bill up (that column gets re-fetched in full on every app load). This uploads the same
 * bytes to the shared `documents` Storage bucket instead and returns a "storage:<path>" marker,
 * matching the format the browser side writes.
 */
export const DOCUMENTS_BUCKET = "documents";
const STORAGE_PREFIX = "storage:";

export function isStoragePath(value: string | null | undefined): value is string {
  return !!value && value.startsWith(STORAGE_PREFIX);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const raw = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}

const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/** Mirrors src/lib/files.ts's mimeForFileName — used only by the backfill function, which has no
 * separate mimeType field to draw on the way the live upload paths (an actual attachment's own
 * content_type, or a File's own .type) do. */
export function mimeForFileName(fileName?: string): string {
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXT_MIME[ext] ?? "application/pdf";
}

/**
 * Resolves the owner folder a document should be uploaded under: the caller's own session
 * (upload-document/reparse-document, which run with the calling landlord's own bearer token) or,
 * for the service-role email webhook with no session, the same `first_landlord_id()` fallback
 * every table's own owner_id DEFAULT uses (20260913100000_multi_tenant_owner_scoping.sql) — so a
 * signed URL request from that same landlord later resolves under the owner-scoped Storage RLS
 * policies (20260917100000_document_storage_bucket.sql).
 */
export async function resolveOwnerId(supabase: SupabaseClient): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (userData?.user?.id) return userData.user.id;
  const { data, error } = await supabase.rpc("first_landlord_id");
  if (error) {
    console.error("[storage] failed to resolve fallback owner id", error);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * Uploads a base64 payload to the documents bucket under the given owner's folder and returns a
 * "storage:<path>" marker. Returns the base64 unchanged (the old, egress-heavy behaviour) if
 * ownerId couldn't be resolved or the upload itself fails, so a Storage outage never drops a
 * document outright.
 */
export async function uploadBase64ToStorage(
  supabase: SupabaseClient,
  base64: string,
  fileName: string | undefined,
  ownerId: string | null,
  mimeType?: string,
): Promise<string> {
  if (!ownerId) return base64;
  try {
    const bytes = base64ToUint8Array(base64);
    const path = `${ownerId}/${crypto.randomUUID()}-${sanitizeFileName(fileName || "file")}`;
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, {
      contentType: mimeType || "application/octet-stream",
    });
    if (error) {
      console.error("[storage] upload failed, keeping inline base64", error);
      return base64;
    }
    return STORAGE_PREFIX + path;
  } catch (e) {
    console.error("[storage] upload threw, keeping inline base64", e);
    return base64;
  }
}

/**
 * Reverse of the above — resolves a "storage:<path>" marker back to real base64 bytes (needed
 * when re-running AI extraction, e.g. reparse-document, on a document that's already been moved
 * to Storage), or returns the value unchanged if it's already inline base64 (a row from before
 * this migration, or the backfill hasn't reached it yet).
 */
export async function resolveStoredBase64(supabase: SupabaseClient, value: string | null | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  if (!isStoragePath(value)) return value;
  const path = value.slice(STORAGE_PREFIX.length);
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) {
    console.error("[storage] failed to download for resolve", error);
    return undefined;
  }
  const buf = new Uint8Array(await data.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < buf.length; i += chunkSize) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
