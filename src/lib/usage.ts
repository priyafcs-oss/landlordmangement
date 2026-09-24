import { supabase } from "@/integrations/supabase/client";

const DOCUMENTS_BUCKET = "documents";
const LIST_PAGE_SIZE = 1000;

async function currentUserId(): Promise<string | undefined> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id;
}

export interface StorageUsageSummary {
  bytes: number;
  fileCount: number;
}

/**
 * A landlord who's connected Google Drive (Settings -> "Connected Google Drive") has their usage
 * summed from their own Drive instead (drive-usage-summary edge function) — this only ever checks
 * connection STATUS, not migration progress, matching src/lib/files.ts's own upload/read paths:
 * once connected, everything new-and-migrated lives in Drive, so that's what's worth reporting.
 * A not-yet-connected owner falls through to the legacy bucket listing below unchanged.
 */
async function isDriveConnected(): Promise<boolean> {
  const { data } = await supabase.from("google_drive_connections").select("status").maybeSingle();
  return data?.status === "connected";
}

/**
 * Sums the size of every object under the signed-in user's own folder in the `documents` bucket —
 * a live, client-side equivalent of backfill-storage's `?report=1` mode (see that function's
 * `totalBucketSize`), scoped by the same `owner_read_documents` Storage policy every other client
 * Storage call already relies on. Uploads never nest subfolders (uploadDocumentFile's path is
 * flat: "<uid>/<uuid>-<name>"), so a single, paginated list of the user's own folder is enough —
 * no recursion needed.
 */
export async function getStorageUsageSummary(): Promise<StorageUsageSummary | null> {
  const uid = await currentUserId();
  if (!uid) return null;

  if (await isDriveConnected()) {
    const { data, error } = await supabase.functions.invoke("drive-usage-summary");
    if (!error && data) return data as StorageUsageSummary;
    console.error("[usage] failed to load drive usage summary", error);
    // Falls through to the (now likely near-empty, for a connected owner) bucket listing below
    // rather than returning null outright, so a transient Drive API failure still shows something.
  }

  let bytes = 0;
  let fileCount = 0;
  let offset = 0;
  for (;;) {
    const { data: entries, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .list(uid, { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      console.error("[usage] failed to list storage", error);
      return null;
    }
    for (const entry of entries ?? []) {
      bytes += entry.metadata?.size ?? 0;
      fileCount++;
    }
    if (!entries || entries.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return { bytes, fileCount };
}

/**
 * Records that a file was actually fetched — not served from the in-memory signed-URL cache
 * (src/lib/files.ts's getSignedDocumentUrl). Fire-and-forget: a logging failure should never
 * block the file the landlord is trying to view.
 */
export function logFileAccess(storagePath: string) {
  supabase
    .from("file_access_log")
    .insert({ storage_path: storagePath })
    .then(({ error }) => {
      if (error) console.error("[usage] failed to log file access", error);
    });
}

export interface DailyAccessCount {
  /** Local calendar-day key, "YYYY-MM-DD". */
  date: string;
  count: number;
}

export interface AccessActivitySummary {
  today: number;
  last7Days: number;
  /** Oldest first, exactly `days` entries, one per local calendar day. */
  byDay: DailyAccessCount[];
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Day-by-day count of real file downloads over the last `days` days (today inclusive), for the
 * signed-in owner — RLS scopes this to their own rows same as every other table. Bucketed by
 * local calendar day (not the UTC day `created_at` serializes as) so "today" matches what the
 * landlord actually sees on their own clock.
 */
export async function getAccessActivity(days: number): Promise<AccessActivitySummary | null> {
  const uid = await currentUserId();
  if (!uid) return null;

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase.from("file_access_log").select("created_at").gte("created_at", since.toISOString());
  if (error) {
    console.error("[usage] failed to load access activity", error);
    return null;
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = localDateKey(new Date(row.created_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const byDay: DailyAccessCount[] = [];
  const cursor = new Date(since);
  let last7Days = 0;
  for (let i = 0; i < days; i++) {
    const key = localDateKey(cursor);
    const count = counts.get(key) ?? 0;
    byDay.push({ date: key, count });
    if (i >= days - 7) last7Days += count;
    cursor.setDate(cursor.getDate() + 1);
  }

  return { today: counts.get(localDateKey(new Date())) ?? 0, last7Days, byDay };
}
