import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Server-side Google Drive counterpart to ./storage.ts — see
 * supabase/migrations/20260924100000_google_drive_connections.sql for the per-owner refresh-token
 * storage (Supabase Vault, never a plain column) this reads from. Each landlord connects their OWN
 * Drive account (OAuth, scope drive.file), so — unlike storage.ts's single shared bucket — every
 * call here needs to know WHICH owner's Drive to act against, and every upload/read is scoped to
 * that owner's own "Landlord OS Documents" root folder, never their whole Drive.
 *
 * Plain fetch() calls to Google's REST endpoints, matching this codebase's existing convention
 * (see ../parse-inbound-bill/gemini.ts) rather than pulling in a Google API client library.
 */
export const GDRIVE_PREFIX = "gdrive:";
export const DRIVE_ROOT_FOLDER_NAME = "Landlord OS Documents";

export function isGoogleDrivePath(value: string | null | undefined): value is string {
  return !!value && value.startsWith(GDRIVE_PREFIX);
}

export function driveFileId(marker: string): string {
  return marker.slice(GDRIVE_PREFIX.length);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}

interface DriveConnectionRow {
  status: string;
  root_folder_id: string | null;
}

/** Cheap check — no token exchange — for callers that only need to know whether to take the Drive
 * branch or fall back to the legacy Supabase Storage path (router.ts, reparse-document). */
export async function getDriveConnection(
  supabase: SupabaseClient,
  ownerId: string | null,
  scope: "self" | "admin",
): Promise<DriveConnectionRow | null> {
  if (!ownerId) return null;
  const query = supabase.from("google_drive_connections").select("status, root_folder_id");
  const { data, error } = scope === "self" ? await query.maybeSingle() : await query.eq("owner_id", ownerId).maybeSingle();
  if (error || !data) return null;
  return data as DriveConnectionRow;
}

export function isOwnerDriveConnected(conn: DriveConnectionRow | null): conn is DriveConnectionRow & { root_folder_id: string } {
  return !!conn && conn.status === "connected" && !!conn.root_folder_id;
}

interface AccessToken {
  accessToken: string;
  rootFolderId: string;
}

/** In-memory only — best-effort, since an edge function isolate isn't guaranteed to stay warm
 * between invocations (unlike src/lib/files.ts's guaranteed-persistent browser-session cache). */
const accessTokenCache = new Map<string, { token: AccessToken; expiresAt: number }>();

async function exchangeRefreshToken(refreshToken: string): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("[googleDrive] GOOGLE_OAUTH_CLIENT_ID/SECRET not configured");
    return null;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[googleDrive] refresh token exchange failed", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.access_token ?? null;
}

/**
 * Resolves a short-lived Drive access token + root folder id for the given owner.
 * scope "self" uses the caller's own session-scoped client + auth.uid() (get_my_google_drive_refresh_token);
 * scope "admin" uses a service-role client + explicit ownerId (admin_get_google_drive_refresh_token) —
 * see the migration's RPC grants for why these are two separate functions, not one.
 * Returns null if the owner isn't connected, has no root folder yet, or the exchange fails.
 */
export async function getAccessTokenForOwner(
  supabase: SupabaseClient,
  ownerId: string | null,
  scope: "self" | "admin",
): Promise<AccessToken | null> {
  if (!ownerId) return null;
  const cached = accessTokenCache.get(ownerId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const conn = await getDriveConnection(supabase, ownerId, scope);
  if (!isOwnerDriveConnected(conn)) return null;

  const { data: refreshToken, error } =
    scope === "self"
      ? await supabase.rpc("get_my_google_drive_refresh_token")
      : await supabase.rpc("admin_get_google_drive_refresh_token", { p_owner_id: ownerId });
  if (error || !refreshToken) {
    console.error("[googleDrive] failed to resolve refresh token", error);
    return null;
  }

  const accessToken = await exchangeRefreshToken(refreshToken as string);
  if (!accessToken) return null;

  const token: AccessToken = { accessToken, rootFolderId: conn.root_folder_id };
  // 5-minute safety margin under Google's real ~1hr access token lifetime.
  accessTokenCache.set(ownerId, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
  return token;
}

/** Used only by the OAuth callback, with the access token from a fresh code exchange (not yet
 * cached above, since there's no ownerId-keyed cache entry to reuse on first connect). */
export async function findOrCreateRootFolder(accessToken: string, folderName: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (listRes.ok) {
    const data = await listRes.json();
    if (data.files?.[0]?.id) return data.files[0].id;
  }
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!createRes.ok) {
    console.error("[googleDrive] failed to create root folder", createRes.status, await createRes.text());
    return null;
  }
  const created = await createRes.json();
  return created.id ?? null;
}

export async function uploadBytesToDrive(
  accessToken: string,
  rootFolderId: string,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  const boundary = `landlordos-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: sanitizeFileName(fileName), parents: [rootFolderId] });
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    encoder.encode(`--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    bytes,
    encoder.encode(`\r\n--${boundary}--`),
  ];
  const totalLength = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.length;
  }

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    console.error("[googleDrive] upload failed", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.id ? GDRIVE_PREFIX + data.id : null;
}

export async function downloadBytesFromDrive(
  accessToken: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error("[googleDrive] download failed", res.status, await res.text());
    return null;
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}

/** Paginated listing of every file under the owner's root folder, for the usage summary — Drive
 * returns `size` as a string for binary files (this app never creates native Google Docs/Sheets,
 * which have no size field, so a plain Number() is safe here without extra guarding). */
export async function listDriveFiles(accessToken: string, rootFolderId: string): Promise<{ id: string; size: number }[]> {
  const files: { id: string; size: number }[] = [];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(`'${rootFolderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,size)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      console.error("[googleDrive] list failed", res.status, await res.text());
      break;
    }
    const data = await res.json();
    for (const f of data.files ?? []) {
      files.push({ id: f.id, size: Number(f.size ?? 0) });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}
