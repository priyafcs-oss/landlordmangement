import { extractAgencyAgreementFields } from "../parse-inbound-bill/parse-agency-agreement.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { isOversizedUpload, MAX_AI_UPLOAD_BASE64_CHARS } from "../_shared/limits.ts";

interface ExtractRequest {
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
}

function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * Stateless extraction-only endpoint for the "Upload & extract" action on an Agent Provider's
 * Management Agreement — reads a signed PMA PDF via Gemini and returns the fee terms for the
 * form to pre-fill. Same pattern as extract-bill: never writes to the database, the landlord
 * reviews/edits the pre-filled fields and hits Save themselves.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: ExtractRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.fileBase64 || !body.fileName || !body.mimeType) {
    return new Response(JSON.stringify({ error: "fileBase64, fileName and mimeType are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!isSupportedAttachment(body.mimeType)) {
    return new Response(JSON.stringify({ error: "Only PDF and image files are supported" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (isOversizedUpload(body.fileBase64)) {
    return new Response(
      JSON.stringify({
        error: `This file is too large for the AI reader (limit ~${Math.round((MAX_AI_UPLOAD_BASE64_CHARS * 0.75) / (1024 * 1024))}MB). Try a lower-resolution scan, or split it into smaller files.`,
      }),
      { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!Deno.env.get("GEMINI_API_KEY")) {
    console.error("[extract-agency-agreement] GEMINI_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const parsed = await extractAgencyAgreementFields({
      subject: `Management agreement upload: ${body.fileName}`,
      fromEmail: "manual-upload",
      pdfBase64: body.fileBase64,
      pdfFileName: body.fileName,
      attachmentMimeType: body.mimeType,
    });
    return new Response(JSON.stringify({ ok: true, ...parsed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[extract-agency-agreement] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Extraction failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
