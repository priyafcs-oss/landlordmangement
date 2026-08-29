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

const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function mimeForFileName(fileName?: string): string {
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXT_MIME[ext] ?? "application/pdf";
}

export function isImageFileName(fileName?: string): boolean {
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  return ext in IMAGE_EXT_MIME;
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
