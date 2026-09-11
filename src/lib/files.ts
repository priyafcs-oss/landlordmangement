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

/**
 * Base64 -> Blob object URL. Chrome (and most modern browsers) block window.open()/top-level
 * navigation to data: URIs as a phishing mitigation, so a document that opens fine embedded in an
 * <iframe>/<img> can still silently fail to open in a new tab via a raw data: URL — blob: URLs
 * aren't subject to that restriction.
 */
export function base64ToBlobUrl(base64: string, mime: string): string {
  return URL.createObjectURL(base64ToBlob(base64, mime));
}

export function openBillDocument(fileName: string | undefined, base64: string | undefined) {
  if (!base64) return;
  window.open(base64ToBlobUrl(base64, mimeForFileName(fileName)), "_blank");
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
