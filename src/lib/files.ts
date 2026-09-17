import { supabase } from "@/integrations/supabase/client";

/**
 * Every AI-extraction edge function embeds the file inline (base64) in a single Gemini
 * `generateContent` request, which Google caps at ~20MB total for the whole request body —
 * base64 inflates a file by ~33%, so this is a conservative ceiling on the RAW file size to stay
 * safely under that after encoding, with room left for the prompt text alongside it. A scanned
 * multi-page PDF (e.g. building plans) can easily blow past this; there's no larger-file path
 * today (that would require switching to Gemini's separate Files API, which uploads first and
 * references the file by URI instead of inlining it).
 */
export const MAX_AI_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Every file this app stores (property photos/videos, lease/compliance/loan documents, bill and
 * expense receipts, ...) used to be inlined as base64 directly in its Postgres column — that
 * column got re-downloaded in full on every app load (src/lib/store.tsx loads every table on
 * mount), which is what actually drove the Supabase egress bill up. Fields matching this pattern
 * (see src/lib/db.ts's migrateFileFieldsToStorage) now hold a "storage:<path>" marker instead,
 * pointing at an object in the private `documents` Storage bucket
 * (supabase/migrations/20260917100000_document_storage_bucket.sql) — fetched only when a file is
 * actually opened, not on every table load. Every function below transparently accepts either
 * form, so a portfolio mid-migration (some rows already backfilled, some not yet) keeps working.
 */
const STORAGE_PREFIX = "storage:";
const DOCUMENTS_BUCKET = "documents";

function isStoragePath(value: string): boolean {
  return value.startsWith(STORAGE_PREFIX);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100);
}

async function currentUserId(): Promise<string | undefined> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id;
}

/**
 * Uploads a File to the signed-in user's own folder in the `documents` bucket (matching every
 * table's owner_id RLS scoping) and returns a "storage:<path>" marker to persist in place of
 * base64. Falls back to inlining as base64 — the old behaviour — when there's no signed-in user
 * to scope the upload to (e.g. the anonymous maintenance-request form) or the upload itself fails,
 * so a Storage outage degrades to the old egress-heavy path instead of losing the file outright.
 */
export async function uploadDocumentFile(file: File): Promise<string> {
  const uid = await currentUserId();
  if (!uid) return readFileAsBase64(file);
  const path = `${uid}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
    contentType: file.type || mimeForFileName(file.name),
  });
  if (error) {
    console.error("[storage] upload failed, falling back to inline base64", error);
    return readFileAsBase64(file);
  }
  return STORAGE_PREFIX + path;
}

/**
 * Same as uploadDocumentFile, for a base64 payload already read into memory — every AI-extraction
 * dialog reads the file as base64 anyway (for the inline Gemini request), so this lets it reuse
 * that instead of reading the File a second time.
 */
export async function uploadDocumentBase64(base64: string, fileName: string | undefined): Promise<string> {
  const uid = await currentUserId();
  if (!uid) return base64;
  const path = `${uid}/${crypto.randomUUID()}-${sanitizeFileName(fileName || "file")}`;
  const blob = base64ToBlob(base64, mimeForFileName(fileName));
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, blob, { contentType: blob.type });
  if (error) {
    console.error("[storage] upload failed, falling back to inline base64", error);
    return base64;
  }
  return STORAGE_PREFIX + path;
}

/** Signed, time-limited URL for a "storage:<path>" marker — null for a legacy inline value (which
 * needs no signing) or on a resolve failure. */
export async function getSignedDocumentUrl(storedValue: string, expiresIn = 3600): Promise<string | null> {
  if (!isStoragePath(storedValue)) return null;
  const path = storedValue.slice(STORAGE_PREFIX.length);
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, expiresIn);
  if (error) {
    console.error("[storage] failed to sign url", error);
    return null;
  }
  return data.signedUrl;
}

/** Resolves either a legacy inline base64 payload or a "storage:<path>" marker to the file's
 * actual bytes. */
export async function resolveDocumentBlob(fileName: string | undefined, storedValue: string | undefined): Promise<Blob | null> {
  if (!storedValue) return null;
  if (!isStoragePath(storedValue)) return base64ToBlob(storedValue, mimeForFileName(fileName));
  const url = await getSignedDocumentUrl(storedValue);
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? res.blob() : null;
}

/** Resolves a stored value to a browser-usable object URL — caller owns calling
 * URL.revokeObjectURL on it once done with it (see BillDocumentViewer's cleanup effect). */
export async function resolveDocumentUrl(fileName: string | undefined, storedValue: string | undefined): Promise<string | null> {
  const blob = await resolveDocumentBlob(fileName, storedValue);
  return blob ? URL.createObjectURL(blob) : null;
}

/** Resolves a stored value to raw bytes — for callers that need to hand a Uint8Array to something
 * other than the DOM (e.g. pdf-lib, see src/lib/leaseTemplate.ts), not just display it. */
export async function resolveDocumentBytes(fileName: string | undefined, storedValue: string | undefined): Promise<Uint8Array | null> {
  const blob = await resolveDocumentBlob(fileName, storedValue);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `supabase.functions.invoke()` throws a generic "Edge Function returned a non-2xx status code"
 * error on any handled server-side failure (file too large, unreadable document, AI extraction
 * error, ...) — the SDK never reads the response body for you, so that specific, actually useful
 * message the function itself returned (every AI-extraction function here always responds with
 * `{ error: "..." }` on failure) gets silently discarded in favour of the generic wrapper text.
 * This recovers it — see the SDK's own documented pattern (`error.context.json()`, since
 * `FunctionsHttpError.context` is the raw unconsumed Response). Falls back to the generic error's
 * own message when there's no readable/JSON body (a network failure, a relay error, ...).
 */
export async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Body wasn't JSON (or already consumed) — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : "Something went wrong — try again.";
}

const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** Shown on every upload dropzone so a landlord knows what will actually work before dropping it
 * — kept as one list so it can't drift from IMAGE_EXT_MIME/isSupportedDocumentFile above. */
export const ACCEPTED_DOCUMENT_TYPES_LABEL = "PDF, JPG, PNG, WebP, GIF, HEIC";
/** `accept` attribute for every upload `<input type="file">` — deliberately the exact types we
 * both preview (isImageFileName) and forward to Gemini, not the browser's broad "image/*" (which
 * would let the OS picker offer formats like BMP/TIFF/SVG that aren't in IMAGE_EXT_MIME and would
 * hit the same "can't preview this" failure mode a non-image/PDF file did). */
export const ACCEPTED_DOCUMENT_TYPES_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

export function mimeForFileName(fileName?: string): string {
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXT_MIME[ext] ?? "application/pdf";
}

export function isImageFileName(fileName?: string): boolean {
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  return ext in IMAGE_EXT_MIME;
}

/**
 * Every AI-extraction dialog's dropzone only reads a PDF or image — the edge functions already
 * reject anything else (see isSupportedAttachment in each `extract-*`/`upload-document` function),
 * but that check only ran server-side, after the file was already read and attached as the
 * "source document" locally. A spreadsheet or Word doc dropped in still looked accepted (shown in
 * the dropzone, offered for preview) right up until BillDocumentViewer tried to render it through
 * the browser's PDF plugin and failed with an opaque "Failed to load PDF document" — nothing told
 * the landlord the file itself was the problem. Checking here, before the file is read at all,
 * lets every dialog reject it immediately with a clear reason instead of a round trip to Gemini
 * (or a broken preview) to discover the same thing.
 */
export function isSupportedDocumentFile(file: File): boolean {
  return file.type === "application/pdf" || file.type.startsWith("image/");
}

/**
 * Different upload paths in this app inconsistently store either a full data URL
 * (`data:application/pdf;base64,...`, e.g. ExpenseDialog/tenant document uploads) or the raw
 * base64 payload alone with the prefix already stripped (e.g. AddBillDialog/AddTransactionDialog) —
 * strip a "data:...;base64," prefix here if present so every caller works either way. Raw base64
 * never legitimately contains a comma, so splitting on the first one is safe.
 */
export function base64ToBlob(base64: string, mime: string): Blob {
  const raw = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const byteChars = atob(raw);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mime });
}

/** Opens a stored file (legacy inline base64, or a storage-backed "storage:<path>" marker) in a
 * new tab via a blob: URL — not a raw data: URI, which Chrome/Edge block from opening in a new
 * tab as a phishing mitigation. Callers invoke this synchronously from onClick handlers, so it
 * stays fire-and-forget (async) rather than something every one of those ~25 call sites has to
 * await. */
export async function openBillDocument(fileName: string | undefined, storedValue: string | undefined) {
  const url = await resolveDocumentUrl(fileName, storedValue);
  if (url) window.open(url, "_blank");
}

/** Reads a File into a full `data:<mime>;base64,<data>` string. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Reads a File into just its base64 payload, with the `data:...;base64,` prefix already stripped. */
export async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
