import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1";
import { parseInboundBill } from "./core-parser.ts";
import type { NormalizedBillInput } from "./types.ts";

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

/**
 * GET /emails/receiving/{id} — email metadata + text/html body. Attachments here are metadata
 * only (id/filename/content_type), never inline content — confirmed against Resend's docs
 * (resend.com/docs/api-reference/emails/retrieve-received-email).
 */
async function fetchReceivedEmail(emailId: string, apiKey: string): Promise<ResendReceivedEmail> {
  const res = await fetch(`${RESEND_BASE_URL}/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch inbound email ${emailId}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ResendReceivedEmail;
}

/**
 * Attachment bytes require two calls: GET .../attachments/{id} for a short-lived signed
 * download_url, then fetching that URL for the actual file
 * (resend.com/docs/api-reference/emails/retrieve-received-email-attachment).
 */
async function fetchAttachmentBase64(emailId: string, attachmentId: string, apiKey: string): Promise<string> {
  const metaRes = await fetch(`${RESEND_BASE_URL}/${emailId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch attachment ${attachmentId}: ${metaRes.status} ${await metaRes.text()}`);
  }
  const meta = (await metaRes.json()) as ResendAttachmentDownload;

  const fileRes = await fetch(meta.download_url);
  if (!fileRes.ok) {
    throw new Error(`Failed to download attachment ${attachmentId}: ${fileRes.status}`);
  }
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function normalize(email: ResendReceivedEmail, apiKey: string): Promise<NormalizedBillInput> {
  const pdfMeta = email.attachments?.find((a) => a.content_type === "application/pdf");
  const pdfBase64 = pdfMeta ? await fetchAttachmentBase64(email.id, pdfMeta.id, apiKey) : undefined;
  return {
    fromEmail: email.from,
    subject: email.subject,
    textBody: email.text ?? undefined,
    pdfBase64,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[parse-inbound-bill] RESEND_WEBHOOK_SECRET is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  const rawBody = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try {
    payload = new Webhook(secret).verify(rawBody, svixHeaders);
  } catch (e) {
    console.error("[parse-inbound-bill] signature verification failed", e);
    return new Response("Invalid signature", { status: 401 });
  }

  if (payload?.type !== "email.received") {
    return new Response("Ignored: not an email.received event", { status: 200 });
  }

  const emailId = payload.data?.email_id;
  if (!emailId) {
    return new Response("Missing data.email_id", { status: 400 });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[parse-inbound-bill] RESEND_API_KEY is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  try {
    const email = await fetchReceivedEmail(emailId, apiKey);
    const input = await normalize(email, apiKey);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await parseInboundBill(supabase, input, emailId);
    if (!result.ok) {
      console.error("[parse-inbound-bill] parse failed", result.error);
      return new Response(JSON.stringify({ error: result.error }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        expenseId: result.expenseId,
        status: result.status,
        reviewReason: result.reviewReason,
        matchedPropertyId: result.matchedPropertyId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[parse-inbound-bill] unhandled error", e);
    return new Response("Internal error", { status: 500 });
  }
});
