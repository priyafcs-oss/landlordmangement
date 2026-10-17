import { isOversizedUpload, MAX_AI_UPLOAD_BASE64_CHARS } from "./limits.ts";
import { isSupportedAttachment, json, preflight, requireUser } from "./http.ts";

export interface ExtractArgs {
  subject: string;
  fromEmail: string;
  pdfBase64: string;
  pdfFileName: string;
  attachmentMimeType: string;
}

/**
 * The one request handler behind every stateless `extract-*` function (bill, loan document,
 * depreciation report, agency agreement, bank statement): sign-in check, body validation, file
 * type and size limits, then the document-specific Gemini extractor. Nothing is written to the
 * database — the app pre-fills a form for the landlord to review.
 *
 * Each extract-* function used to carry its own ~85-line copy of this, none of which checked the
 * caller was signed in (so anyone with the URL could spend the Gemini quota).
 */
export function handleExtract<T>(opts: {
  tag: string;
  subjectPrefix: string;
  extract: (args: ExtractArgs) => Promise<T>;
  /** Response body for a successful extraction (default: `{ ok: true, ...result }`). */
  shape?: (result: T) => Record<string, unknown>;
}): (req: Request) => Promise<Response> {
  return async (req) => {
    const early = preflight(req);
    if (early) return early;

    const user = await requireUser(req);
    if (user instanceof Response) return user;

    let body: { fileBase64?: string; fileName?: string; mimeType?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (!body.fileBase64 || !body.fileName || !body.mimeType) {
      return json({ error: "fileBase64, fileName and mimeType are required" }, 400);
    }
    if (!isSupportedAttachment(body.mimeType)) return json({ error: "Only PDF and image files are supported" }, 422);
    if (isOversizedUpload(body.fileBase64)) {
      const mb = Math.round((MAX_AI_UPLOAD_BASE64_CHARS * 0.75) / (1024 * 1024));
      return json(
        { error: `This file is too large for the AI reader (limit ~${mb}MB). Try a lower-resolution scan, or split it into smaller files.` },
        413,
      );
    }
    if (!Deno.env.get("GEMINI_API_KEY")) {
      console.error(`[${opts.tag}] GEMINI_API_KEY is not configured`);
      return json({ error: "Server misconfigured" }, 500);
    }

    try {
      const result = await opts.extract({
        subject: `${opts.subjectPrefix}: ${body.fileName}`,
        fromEmail: "manual-upload",
        pdfBase64: body.fileBase64,
        pdfFileName: body.fileName,
        attachmentMimeType: body.mimeType,
      });
      return json(opts.shape ? { ok: true, ...opts.shape(result) } : { ok: true, ...(result as object) });
    } catch (e) {
      console.error(`[${opts.tag}] unhandled error`, e);
      return json({ error: e instanceof Error ? e.message : "Extraction failed" }, 500);
    }
  };
}
