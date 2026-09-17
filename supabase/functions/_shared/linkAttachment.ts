/**
 * Some providers email "click here to view your bill" with a link instead of attaching a PDF
 * (see the Cornelia Rd water bill report — it landed with source "Manual" instead of a real
 * document because the pipeline only ever reads actual email attachments, never a URL mentioned
 * in the body). This tries fetching such a link server-side and treats the result as the
 * attachment when it resolves to a PDF or image within a sane size — same handling an actual
 * Resend attachment would get from here on.
 */
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const MAX_LINK_ATTACHMENT_BYTES = 12 * 1024 * 1024; // mirrors src/lib/files.ts's MAX_AI_UPLOAD_BYTES
const FETCH_TIMEOUT_MS = 15_000;
// Cap how many candidate links a single email body is worth trying — most bodies have at most a
// couple of real links, and this avoids a burst of requests for something like a long email
// signature full of social/legal links.
const MAX_CANDIDATE_LINKS = 3;

export interface LinkAttachment {
  base64: string;
  fileName: string;
  mimeType: string;
}

function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.match(URL_REGEX) ?? [])].slice(0, MAX_CANDIDATE_LINKS);
}

function isSupportedContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return base === "application/pdf" || base.startsWith("image/");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Tries every http(s) link found in the body text, in order, until one resolves to a PDF/image
 * under the size ceiling — returns null (not an error) if none do, since most email bodies
 * mentioning a link aren't actually offering the bill itself that way (an unsubscribe link, a
 * logo, a "manage preferences" page), and this is a best-effort fallback, not a required step.
 */
export async function tryFetchLinkedAttachment(bodyText: string | null | undefined): Promise<LinkAttachment | null> {
  for (const url of extractUrls(bodyText)) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type");
      if (!isSupportedContentType(contentType)) continue;
      const declaredLength = Number(res.headers.get("content-length") ?? "0");
      if (declaredLength && declaredLength > MAX_LINK_ATTACHMENT_BYTES) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_LINK_ATTACHMENT_BYTES) continue;
      const mimeType = (contentType ?? "application/pdf").split(";")[0].trim();
      const ext = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1]?.split("+")[0] || "bin";
      return { base64: base64FromBytes(bytes), fileName: `bill-from-link.${ext}`, mimeType };
    } catch (e) {
      console.warn(`[parse-inbound-bill] failed to fetch linked attachment "${url}"`, e);
    }
  }
  return null;
}
