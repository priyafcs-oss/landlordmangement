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

/** Sentinel attachmentId for the text-only case (no attachment at all) — a fixed non-null value
 * so the (emailId, attachmentId) uniqueness on email_inbox_log still dedupes a Svix webhook retry
 * for that case, the same way a plain emailId column used to before an email could produce more
 * than one logged row. */
const NO_ATTACHMENT_ID = "text-only";

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
 * Every (email, attachment) pair this webhook processes gets exactly one row here, regardless of
 * outcome — unlike ai_intake_proposals, which only ever gets a row when classification/extraction
 * actually succeeds. Upserts on (emailId, attachmentId) so a Svix webhook retry overwrites the
 * same row with the latest outcome instead of duplicating it — see NO_ATTACHMENT_ID for the
 * text-only case. Best-effort: a logging failure is reported to the function log but never fails
 * the request — the document itself has already been processed (or failed) by the time this runs.
 */
async function logEmailInbox(
  supabase: SupabaseClient,
  fields: {
    emailId: string;
    attachmentId: string;
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
    attachmentId: fields.attachmentId,
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
  const { error } = await supabase.from("email_inbox_log").upsert(row, { onConflict: "emailId,attachmentId" });
  if (error) console.error("[parse-inbound-bill] failed to write email_inbox_log", error);
}

/** Gemini reads PDFs and common image formats natively as inlineData — anything else (xlsx, docx, csv, ...) is skipped. */
function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * Picks every attachment worth processing as its own document — an email can carry several
 * genuine attachments (e.g. three separate water bills batched into one forward), and each one
 * now gets classified/extracted/staged independently, same as selecting multiple files at once in
 * the manual Upload dialog. Forwarded emails often also carry inline images (signature logos,
 * tracking pixels) ahead of or alongside the real document(s) — those are excluded whenever at
 * least one non-inline supported attachment exists. Only when EVERY supported attachment is
 * marked inline (some mail clients mark everything that way) does this fall back to a single
 * best-guess pick, to avoid risking a signature logo being processed as its own document.
 */
function pickAttachments(attachments: ResendAttachmentMeta[]): ResendAttachmentMeta[] {
  const supported = attachments.filter((a) => isSupportedAttachment(a.content_type));
  const notInline = supported.filter((a) => a.content_disposition !== "inline");
  if (notInline.length > 0) return notInline;
  const bestInline = supported.find((a) => a.content_type === "application/pdf") ?? supported[0];
  return bestInline ? [bestInline] : [];
}

async function normalizeOne(
  email: ResendReceivedEmail,
  apiKey: string,
  attachmentMeta: ResendAttachmentMeta | undefined,
): Promise<NormalizedBillInput> {
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

  let email: ResendReceivedEmail | undefined;
  try {
    email = await fetchReceivedEmail(emailId, apiKey);

    const unsupported = (email.attachments ?? []).filter((a) => !isSupportedAttachment(a.content_type));
    if (unsupported.length > 0) {
      console.warn(
        `[parse-inbound-bill] skipping unsupported attachment type(s): ${unsupported.map((a) => `${a.filename} (${a.content_type})`).join(", ")} — only PDF and image attachments can be read`,
      );
    }

    const attachmentMetas = pickAttachments(email.attachments ?? []);

    if (attachmentMetas.length === 0 && !email.text?.trim()) {
      const attachmentSummary = email.attachments?.length
        ? email.attachments.map((a) => `${a.filename} (${a.content_type})`).join(", ")
        : "none";
      const error = `No readable content: no PDF/image attachment and no email body text. Attachments received: ${attachmentSummary}`;
      console.error(`[parse-inbound-bill] ${error}`);
      await logEmailInbox(supabase, {
        emailId,
        attachmentId: NO_ATTACHMENT_ID,
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

    // Text-only email (no attachment at all) processes exactly like before — one input, keyed by
    // the plain emailId for idempotency, same as every row already on file predates this change.
    // One or more real attachments each become their own document, keyed by (emailId, attachment
    // id) so a Svix retry of the same webhook still dedupes per attachment rather than per email.
    const jobs: { attachmentMeta: ResendAttachmentMeta | undefined; attachmentId: string; emailMessageId: string }[] =
      attachmentMetas.length === 0
        ? [{ attachmentMeta: undefined, attachmentId: NO_ATTACHMENT_ID, emailMessageId: emailId }]
        : attachmentMetas.map((a) => ({ attachmentMeta: a, attachmentId: a.id, emailMessageId: `${emailId}:${a.id}` }));

    // Sequential — same reasoning as the manual bulk-upload dialog: avoids a burst of concurrent
    // Gemini calls when one email carries several attachments.
    const results: { ok: boolean; error?: string }[] = [];
    for (const job of jobs) {
      try {
        const input = await normalizeOne(email, apiKey, job.attachmentMeta);

        if (input.pdfBase64 && isOversizedUpload(input.pdfBase64)) {
          const error = `Attachment too large for the AI reader (limit ~${Math.round((MAX_AI_UPLOAD_BASE64_CHARS * 0.75) / (1024 * 1024))}MB) — a scanned multi-page document likely needs to be compressed or split before forwarding.`;
          console.error(`[parse-inbound-bill] ${error}`);
          await logEmailInbox(supabase, {
            emailId,
            attachmentId: job.attachmentId,
            fromAddress: email.from,
            subject: email.subject,
            hasAttachment: true,
            attachmentFileName: input.pdfFileName,
            status: "failed",
            errorMessage: error,
          });
          results.push({ ok: false, error });
          continue;
        }

        const result = await routeInboundDocument(supabase, input, job.emailMessageId);
        const documentType = "documentType" in result ? result.documentType : undefined;
        const proposalId = "proposalId" in result ? result.proposalId : undefined;
        const billId = "billId" in result ? result.billId : undefined;

        if (!result.ok) {
          console.error("[parse-inbound-bill] parse failed", result.error);
          await logEmailInbox(supabase, {
            emailId,
            attachmentId: job.attachmentId,
            fromAddress: email.from,
            subject: email.subject,
            hasAttachment: !!input.pdfBase64,
            attachmentFileName: input.pdfFileName,
            status: "failed",
            documentType,
            errorMessage: result.error,
          });
          results.push({ ok: false, error: result.error });
          continue;
        }

        await logEmailInbox(supabase, {
          emailId,
          attachmentId: job.attachmentId,
          fromAddress: email.from,
          subject: email.subject,
          hasAttachment: !!input.pdfBase64,
          attachmentFileName: input.pdfFileName,
          status: result.skipped ? "skipped" : proposalId ? "staged" : "processed",
          documentType,
          proposalId,
          billId,
        });
        results.push({ ok: true });
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Internal error";
        console.error("[parse-inbound-bill] attachment processing failed", errorMessage);
        await logEmailInbox(supabase, {
          emailId,
          attachmentId: job.attachmentId,
          fromAddress: email.from,
          subject: email.subject,
          hasAttachment: !!job.attachmentMeta,
          attachmentFileName: job.attachmentMeta?.filename,
          status: "failed",
          errorMessage,
        });
        results.push({ ok: false, error: errorMessage });
      }
    }

    // Resend only cares about the HTTP status (200 = don't retry) — every job already has its own
    // outcome recorded in email_inbox_log, so a partial failure among several attachments still
    // returns 200 rather than causing Resend to retry the ones that already succeeded.
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[parse-inbound-bill] unhandled error", e);
    const errorMessage = e instanceof Error ? e.message : "Internal error";
    await logEmailInbox(supabase, {
      emailId,
      attachmentId: NO_ATTACHMENT_ID,
      fromAddress: email?.from,
      subject: email?.subject,
      hasAttachment: (email?.attachments?.length ?? 0) > 0,
      status: "failed",
      errorMessage,
    });
    return new Response("Internal error", { status: 500 });
  }
});
