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

export function base64ToBlob(base64: string, mime: string): Blob {
  const byteChars = atob(base64);
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
