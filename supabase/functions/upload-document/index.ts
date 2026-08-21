import { createClient } from "npm:@supabase/supabase-js@2";
import { routeInboundDocument } from "../parse-inbound-bill/router.ts";
import type { NormalizedBillInput } from "../parse-inbound-bill/types.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { isOversizedUpload, MAX_AI_UPLOAD_BASE64_CHARS } from "../_shared/limits.ts";

interface UploadRequest {
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
}

/** Gemini reads PDFs and common image formats natively as inlineData — anything else is rejected. */
function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * Lets the landlord upload a bill, rent statement or lease agreement directly from the app,
 * instead of only via the email inbox — same classify → extract → stage pipeline as
 * parse-inbound-bill, just fed from a direct file upload rather than a Resend webhook. Requires
 * a valid Supabase Auth session (default JWT verification — no --no-verify-jwt), since this is
 * called from the logged-in landlord's browser via supabase.functions.invoke, unlike the email
 * webhook which has no user session to authenticate.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: UploadRequest;
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

  const input: NormalizedBillInput = {
    fromEmail: "manual-upload",
    subject: `Manual upload: ${body.fileName}`,
    pdfBase64: body.fileBase64,
    pdfFileName: body.fileName,
    attachmentMimeType: body.mimeType,
  };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const result = await routeInboundDocument(supabase, input, null);
    if (!result.ok) {
      console.error("[upload-document] parse failed", result.error);
      return new Response(JSON.stringify({ error: result.error }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[upload-document] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
