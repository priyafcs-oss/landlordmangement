import { extractBankStatementFields } from "../parse-inbound-bill/parse-bank-statement.ts";
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
 * Stateless extraction-only endpoint for Rental Hub's Bank Feed Import — reads a bank statement
 * PDF/photo and returns its transaction list, delegating to the same extractBankStatementFields
 * the classify→stage pipeline uses (parse-inbound-bill/parse-bank-statement.ts) so the prompt and
 * schema can never drift between the two callers. Unlike parse-inbound-bill/upload-document, this
 * never writes to the database: matching a transaction to a tenant and posting it to the ledger
 * stays exactly the human-confirmed, client-side flow it already is for pasted/CSV statements —
 * this just adds a PDF/photo source into that same matching step.
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
    console.error("[extract-bank-statement] GEMINI_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const parsed = await extractBankStatementFields({
      subject: `Bank statement upload: ${body.fileName}`,
      fromEmail: "manual-upload",
      pdfBase64: body.fileBase64,
      pdfFileName: body.fileName,
      attachmentMimeType: body.mimeType,
    });
    return new Response(JSON.stringify({ ok: true, transactions: parsed.transactions ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[extract-bank-statement] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Extraction failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
