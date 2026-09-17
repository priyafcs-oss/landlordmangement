import { createClient } from "npm:@supabase/supabase-js@2";
import { routeInboundDocument } from "../parse-inbound-bill/router.ts";
import type { NormalizedBillInput } from "../parse-inbound-bill/types.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { isOversizedUpload, MAX_AI_UPLOAD_BASE64_CHARS } from "../_shared/limits.ts";
import { tryFetchLinkedAttachment } from "../_shared/linkAttachment.ts";

interface RetryRequest {
  emailId?: string;
  attachmentId?: string;
}

interface ResendAttachmentMeta {
  id: string;
  filename: string;
  content_type: string;
}
interface ResendReceivedEmail {
  id: string;
  from: string;
  subject: string;
  text: string | null;
  attachments: ResendAttachmentMeta[];
}
interface ResendAttachmentDownload {
  download_url: string;
}

const RESEND_BASE_URL = "https://api.resend.com/emails/receiving";
const NO_ATTACHMENT_ID = "text-only";

/** Same two Resend calls parse-inbound-bill/index.ts makes on the original webhook — duplicated
 * rather than shared, so a retry never risks perturbing the webhook's own request-handling path. */
async function fetchReceivedEmail(emailId: string, apiKey: string): Promise<ResendReceivedEmail> {
  const res = await fetch(`${RESEND_BASE_URL}/${emailId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Failed to fetch inbound email ${emailId}: ${res.status} ${await res.text()}`);
  return (await res.json()) as ResendReceivedEmail;
}

async function fetchAttachmentBase64(emailId: string, attachmentId: string, apiKey: string): Promise<string> {
  const metaRes = await fetch(`${RESEND_BASE_URL}/${emailId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!metaRes.ok) throw new Error(`Failed to fetch attachment ${attachmentId}: ${metaRes.status} ${await metaRes.text()}`);
  const meta = (await metaRes.json()) as ResendAttachmentDownload;
  const fileRes = await fetch(meta.download_url);
  if (!fileRes.ok) throw new Error(`Failed to download attachment ${attachmentId}: ${fileRes.status}`);
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Lets a landlord retry a failed/skipped inbox entry from the app instead of re-forwarding the
 * original email. Re-fetches the email (and, if there was one, the specific attachment this row
 * is for) fresh from Resend by the stored (emailId, attachmentId), then runs it through the exact
 * same classify → extract → stage pipeline the original webhook used.
 *
 * Uses a Supabase client scoped to the caller's own session (verified below), not the service-role
 * key — same reasoning as upload-document/reparse-document — so the `email_inbox_log` lookup below
 * can only ever find the calling landlord's own entry, and the retry's writes land under their
 * owner_id automatically via RLS.
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
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: RetryRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.emailId || !body.attachmentId) {
    return new Response(JSON.stringify({ error: "emailId and attachmentId are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: existing, error: loadError } = await supabase
    .from("email_inbox_log")
    .select("*")
    .eq("emailId", body.emailId)
    .eq("attachmentId", body.attachmentId)
    .maybeSingle();
  if (loadError || !existing) {
    return new Response(JSON.stringify({ error: "Inbox entry not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[retry-inbound-email] RESEND_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const email = await fetchReceivedEmail(body.emailId, apiKey);
    const attachmentMeta =
      body.attachmentId === NO_ATTACHMENT_ID ? undefined : email.attachments?.find((a) => a.id === body.attachmentId);

    // No real attachment for this attemptId — try a link in the body before falling back to
    // body-text-only extraction (see linkAttachment.ts; same fallback normalizeOne uses).
    const linked = attachmentMeta ? null : await tryFetchLinkedAttachment(email.text);
    const pdfBase64 = attachmentMeta ? await fetchAttachmentBase64(email.id, attachmentMeta.id, apiKey) : linked?.base64;
    if (pdfBase64 && isOversizedUpload(pdfBase64)) {
      const error = `Attachment too large for the AI reader (limit ~${Math.round((MAX_AI_UPLOAD_BASE64_CHARS * 0.75) / (1024 * 1024))}MB).`;
      await supabase.from("email_inbox_log").update({ status: "failed", errorMessage: error }).eq("id", existing.id);
      return new Response(JSON.stringify({ error }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const input: NormalizedBillInput = {
      fromEmail: email.from,
      subject: email.subject,
      textBody: email.text ?? undefined,
      pdfBase64,
      pdfFileName: attachmentMeta?.filename ?? linked?.fileName,
      attachmentMimeType: attachmentMeta?.content_type ?? linked?.mimeType,
    };

    const emailMessageId = body.attachmentId === NO_ATTACHMENT_ID ? body.emailId : `${body.emailId}:${body.attachmentId}`;
    const result = await routeInboundDocument(supabase, input, emailMessageId);
    const documentType = "documentType" in result ? result.documentType : undefined;
    const proposalId = "proposalId" in result ? result.proposalId : undefined;
    const billId = "billId" in result ? result.billId : undefined;

    await supabase
      .from("email_inbox_log")
      .update({
        status: result.ok ? (result.skipped ? "skipped" : proposalId ? "staged" : "processed") : "failed",
        documentType,
        proposalId: proposalId ?? null,
        billId: billId ?? null,
        errorMessage: result.ok ? null : result.error,
      })
      .eq("id", existing.id);

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, documentType, proposalId, billId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Retry failed";
    console.error("[retry-inbound-email] failed", e);
    await supabase.from("email_inbox_log").update({ status: "failed", errorMessage }).eq("id", existing.id);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
