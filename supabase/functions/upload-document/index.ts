import { createClient } from "npm:@supabase/supabase-js@2";
import { routeInboundDocument } from "../parse-inbound-bill/router.ts";
import type { NormalizedBillInput } from "../parse-inbound-bill/types.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { isOversizedUpload, MAX_AI_UPLOAD_BASE64_CHARS } from "../_shared/limits.ts";

interface UploadRequest {
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  /** Set by the "Upload statement to this loan" button — see NormalizedBillInput.loanIdHint. */
  loanId?: string;
  /** Set by the "Upload statement" button on a BankAccount — see NormalizedBillInput.bankAccountIdHint. */
  bankAccountId?: string;
}

/** Gemini reads PDFs and common image formats natively as inlineData — anything else is rejected. */
function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * Lets the landlord upload a bill, rent statement or lease agreement directly from the app,
 * instead of only via the email inbox — same classify → extract → stage pipeline as
 * parse-inbound-bill, just fed from a direct file upload rather than a Resend webhook.
 *
 * `verify_jwt = false` in config.toml because this project uses the newer opaque
 * sb_publishable_/sb_secret_ key format for its API key, which isn't a JWT and would fail the
 * gateway's verification unconditionally — but a signed-in user's session token IS a real JWT, so
 * it's checked explicitly below instead, and the Supabase client used for every DB write in this
 * request is built from THAT token rather than the service-role key. That's what makes every row
 * this function writes land under the calling landlord's own `owner_id` for free, via the
 * owner-scoped RLS policies (20260913100000_multi_tenant_owner_scoping.sql) — no manual owner_id
 * plumbing needed through the classify/extract parsers this dispatches to.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userScopedSupabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userScopedSupabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
    loanIdHint: body.loanId,
    bankAccountIdHint: body.bankAccountId,
  };

  try {
    const result = await routeInboundDocument(userScopedSupabase, input, null);
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
