import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1";
import { parseInboundBill } from "./core-parser.ts";
import type { NormalizedBillInput } from "./types.ts";

interface ResendAttachment {
  filename: string;
  contentType: string;
  /** base64-encoded attachment content. */
  content: string;
}

interface ResendInboundEmail {
  from: string;
  subject: string;
  text?: string;
  attachments?: ResendAttachment[];
}

/**
 * Fetches the full inbound email (body + attachments) by id.
 * NOTE: mirrors `resend.emails.receiving.get(emailId)` in raw REST form — verify this exact
 * path against current Resend inbound-email docs before relying on it in production; if the
 * shape differs this is the only function that needs to change.
 */
async function fetchInboundEmail(emailId: string): Promise<ResendInboundEmail> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch inbound email ${emailId}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ResendInboundEmail;
}

function normalize(email: ResendInboundEmail): NormalizedBillInput {
  const pdfAttachment = email.attachments?.find((a) => a.contentType === "application/pdf");
  return {
    fromEmail: email.from,
    subject: email.subject,
    textBody: email.text,
    pdfBase64: pdfAttachment?.content,
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

  try {
    const email = await fetchInboundEmail(emailId);
    const input = normalize(email);

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
