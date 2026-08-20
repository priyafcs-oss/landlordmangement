import { extractDepreciationReportFields } from "../parse-inbound-bill/parse-depreciation-report.ts";
import { corsHeaders } from "../_shared/cors.ts";

interface ExtractRequest {
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
}

function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * Stateless extraction-only endpoint for the "Add depreciation report" dialog's upload — reads a
 * quantity surveyor's report via Gemini (same prompt/schema as the email-ingestion pipeline) and
 * returns the parsed fields for the form to pre-fill. Never writes to the database.
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

  if (!Deno.env.get("GEMINI_API_KEY")) {
    console.error("[extract-depreciation-report] GEMINI_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const parsed = await extractDepreciationReportFields({
      subject: `Depreciation report upload: ${body.fileName}`,
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
    console.error("[extract-depreciation-report] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Extraction failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
