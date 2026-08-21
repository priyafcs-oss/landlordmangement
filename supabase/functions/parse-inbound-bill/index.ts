import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1";
import { routeInboundDocument } from "./router.ts";
import type { NormalizedBillInput } from "./types.ts";
import { isOversizedUpload, MAX_AI_UPLOAD_BASE64_CHARS } from "../_shared/limits.ts";

interface ResendAttachmentMeta {
  id: string;
  filename: string;
  content_type: string;
  /** "inline" = embedded in the email body (signature logos, tracking pixels) — not the actual document. */
  content_disposition?: string;
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

/**
 * Every email this webhook is invoked for gets exactly one row here, regardless of outcome —
 * unlike ai_intake_proposals, which only ever gets a row when classification/extraction
 * actually succeeds. Upserts on emailId so a Svix webhook retry overwrites the same row with
 * the latest outcome instead of duplicating it. Best-effort: a logging failure is reported to
 * the function log but never fails the request — the email itself has already been processed
 * (or failed) by the time this runs.
 */
async function logEmailInbox(
  supabase: SupabaseClient,
  fields: {
    emailId: string;
    fromAddress?: string;
    subject?: string;
    hasAttachment: boolean;
    attachmentFileName?: string;
    status: "processed" | "staged" | "skipped" | "failed";
    documentType?: string;
    proposalId?: string;
    billId?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const row = {
    id: `eml_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    emailId: fields.emailId,
    fromAddress: fields.fromAddress ?? null,
    subject: fields.subject ?? null,
    hasAttachment: fields.hasAttachment,
    attachmentFileName: fields.attachmentFileName ?? null,
    status: fields.status,
    documentType: fields.documentType ?? null,
    proposalId: fields.proposalId ?? null,
    billId: fields.billId ?? null,
    errorMessage: fields.errorMessage ?? null,
  };
  const { error } = await supabase.from("email_inbox_log").upsert(row, { onConflict: "emailId" });
  if (error) console.error("[parse-inbound-bill] failed to write email_inbox_log", error);
}

/** Gemini reads PDFs and common image formats natively as inlineData — anything else (xlsx, docx, csv, ...) is skipped. */
function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * Picks the attachment most likely to actually BE the bill, not just the first supported one.
 * Forwarded emails often carry inline images (signature logos, tracking pixels) ahead of the
 * real document in the attachments array — a naive "first supported" pick grabs those instead
 * of the PDF, feeding Gemini a signature image and getting a correctly-empty extraction back.
 * Preference order: non-inline PDF > non-inline image > any PDF > any image.
 */
function pickAttachment(attachments: ResendAttachmentMeta[]): ResendAttachmentMeta | undefined {
  const supported = attachments.filter((a) => isSupportedAttachment(a.content_type));
  const notInline = supported.filter((a) => a.content_disposition !== "inline");
  return (
    notInline.find((a) => a.content_type === "application/pdf") ??
    notInline[0] ??
    supported.find((a) => a.content_type === "application/pdf") ??
    supported[0]
  );
}

async function normalize(email: ResendReceivedEmail, apiKey: string): Promise<NormalizedBillInput> {
  const attachmentMeta = pickAttachment(email.attachments ?? []);
  const unsupported = email.attachments?.filter((a) => !isSupportedAttachment(a.content_type)) ?? [];
  if (unsupported.length > 0) {
    console.warn(
      `[parse-inbound-bill] skipping unsupported attachment type(s): ${unsupported.map((a) => `${a.filename} (${a.content_type})`).join(", ")} — only PDF and image attachments can be read`,
    );
  }
  const pdfBase64 = attachmentMeta ? await fetchAttachmentBase64(email.id, attachmentMeta.id, apiKey) : undefined;
  return {
    fromEmail: email.from,
    subject: email.subject,
    textBody: email.text ?? undefined,
    pdfBase64,
    pdfFileName: attachmentMeta?.filename,
    attachmentMimeType: attachmentMeta?.content_type,
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Populated once fetchReceivedEmail succeeds — kept outside the try block so the catch below
  // can still log a from/subject-bearing row if something later throws.
  let email: ResendReceivedEmail | undefined;
  try {
    email = await fetchReceivedEmail(emailId, apiKey);
    const input = await normalize(email, apiKey);

    if (!input.pdfBase64 && !input.textBody?.trim()) {
      const attachmentSummary = email.attachments?.length
        ? email.attachments.map((a) => `${a.filename} (${a.content_type})`).join(", ")
        : "none";
      const error = `No readable content: no PDF/image attachment and no email body text. Attachments received: ${attachmentSummary}`;
      console.error(`[parse-inbound-bill] ${error}`);
      await logEmailInbox(supabase, {
        emailId,
        fromAddress: email.from,
        subject: email.subject,
        hasAttachment: (email.attachments?.length ?? 0) > 0,
        status: "failed",
        errorMessage: error,
      });
      return new Response(JSON.stringify({ error }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (input.pdfBase64 && isOversizedUpload(input.pdfBase64)) {
      const error = `Attachment too large for the AI reader (limit ~${Math.round((MAX_AI_UPLOAD_BASE64_CHARS * 0.75) / (1024 * 1024))}MB) — a scanned multi-page document likely needs to be compressed or split before forwarding.`;
      console.error(`[parse-inbound-bill] ${error}`);
      await logEmailInbox(supabase, {
        emailId,
        fromAddress: email.from,
        subject: email.subject,
        hasAttachment: true,
        attachmentFileName: input.pdfFileName,
        status: "failed",
        errorMessage: error,
      });
      return new Response(JSON.stringify({ error }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await routeInboundDocument(supabase, input, emailId);
    const documentType = "documentType" in result ? result.documentType : undefined;
    const proposalId = "proposalId" in result ? result.proposalId : undefined;
    const billId = "billId" in result ? result.billId : undefined;

    if (!result.ok) {
      console.error("[parse-inbound-bill] parse failed", result.error);
      await logEmailInbox(supabase, {
        emailId,
        fromAddress: email.from,
        subject: email.subject,
        hasAttachment: !!input.pdfBase64,
        attachmentFileName: input.pdfFileName,
        status: "failed",
        documentType,
        errorMessage: result.error,
      });
      return new Response(JSON.stringify({ error: result.error }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    await logEmailInbox(supabase, {
      emailId,
      fromAddress: email.from,
      subject: email.subject,
      hasAttachment: !!input.pdfBase64,
      attachmentFileName: input.pdfFileName,
      status: result.skipped ? "skipped" : proposalId ? "staged" : "processed",
      documentType,
      proposalId,
      billId,
    });

    return new Response(
      JSON.stringify({
        skipped: result.skipped,
        billId,
        proposalId,
        status: "status" in result ? result.status : undefined,
        reviewReason: "reviewReason" in result ? result.reviewReason : undefined,
        matchedPropertyId: "matchedPropertyId" in result ? result.matchedPropertyId : undefined,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[parse-inbound-bill] unhandled error", e);
    const errorMessage = e instanceof Error ? e.message : "Internal error";
    await logEmailInbox(supabase, {
      emailId,
      fromAddress: email?.from,
      subject: email?.subject,
      hasAttachment: (email?.attachments?.length ?? 0) > 0,
      status: "failed",
      errorMessage,
    });
    return new Response("Internal error", { status: 500 });
  }
});
