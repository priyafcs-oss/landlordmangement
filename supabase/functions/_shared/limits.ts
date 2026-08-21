/**
 * Every AI-extraction function embeds the file inline (base64) in a single Gemini
 * `generateContent` request, which Google caps at ~20MB total for the whole request body.
 * Mirrors MAX_AI_UPLOAD_BYTES in src/lib/files.ts — the frontend already blocks an oversized
 * file before upload, but a large file could still reach here directly (a stale client build,
 * a raw API call), so this is a second, authoritative check rather than relying solely on the UI.
 */
export const MAX_AI_UPLOAD_BASE64_CHARS = 16 * 1024 * 1024;

export function isOversizedUpload(fileBase64: string): boolean {
  return fileBase64.length > MAX_AI_UPLOAD_BASE64_CHARS;
}
