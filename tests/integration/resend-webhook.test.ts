// Imports real Deno-runtime source under Node — excluded from tsc/editor type-checking via
// tsconfig.json's `exclude`; see tests/setup.edge.ts's doc comment for why.
/**
 * Integration test for the REAL webhook handler this app runs in production —
 * supabase/functions/parse-inbound-bill/index.ts — imported and invoked directly, not a
 * reimplementation of a Next.js API route (this pipeline is a Supabase Edge Function; there is no
 * Next.js anywhere in this codebase).
 *
 * Two things worth knowing about the real code before reading these assertions:
 * 1. Signature verification uses the real `svix` npm package (`new Webhook(secret).verify(...)`),
 *    not manual HMAC — Resend's inbound webhooks are Svix-branded under the hood. On failure it
 *    returns exactly `401` with body `"Invalid signature"`.
 * 2. `index.ts` calls `Deno.serve(handler)` at module load time — tests/setup.edge.ts's Deno shim
 *    is extended right here (not globally) to CAPTURE that handler instead of trying to bind a
 *    real port, so it can be invoked directly with constructed Request objects.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjupd3xVWDNc9Wgqu3B"; // a syntactically valid (but fake) Svix test secret

function signSvixPayload(secret: string, id: string, timestamp: string, body: string): string {
  // Svix's own documented manual-verification scheme: HMAC-SHA256 over "{id}.{timestamp}.{body}",
  // keyed by the base64 portion of the whsec_... secret, base64-encoded and "v1,"-prefixed.
  const secretBytes = Buffer.from(secret.split("_").slice(1).join("_"), "base64");
  const signedContent = `${id}.${timestamp}.${body}`;
  const signature = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  return `v1,${signature}`;
}

function svixHeaders(secret: string, body: string, valid: boolean) {
  const id = "msg_test123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": valid ? signSvixPayload(secret, id, timestamp, body) : "v1,not-a-real-signature",
  };
}

const { mockSupabaseClient, mockCreateClient, emailInboxUpsert, entitiesSelect } = vi.hoisted(() => {
  const emailInboxUpsert = vi.fn().mockResolvedValue({ error: null });
  const entitiesSelect = vi.fn().mockResolvedValue({ data: [], error: null });
  const from = vi.fn((table: string) => {
    if (table === "entities") return { select: entitiesSelect };
    if (table === "email_inbox_log") return { upsert: emailInboxUpsert };
    // Any other table this specific no-attachment/"other"-classified path shouldn't touch — resolves
    // harmlessly rather than throwing, so a genuinely unexpected extra call surfaces as a failed
    // assertion on the spies above instead of an opaque runtime crash deep in router.ts.
    return { select: vi.fn().mockResolvedValue({ data: [], error: null }), upsert: vi.fn().mockResolvedValue({ data: null, error: null }) };
  });
  const mockSupabaseClient = { from } as unknown as SupabaseClient;
  return { mockSupabaseClient, mockCreateClient: vi.fn(() => mockSupabaseClient), emailInboxUpsert, entitiesSelect };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mockCreateClient }));

type Handler = (req: Request) => Promise<Response> | Response;
let handler: Handler;

beforeAll(async () => {
  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";

  // Capture Deno.serve's handler instead of letting it try to bind a real port — tests/setup.edge.ts
  // already shimmed Deno.env; this extends the SAME global with `serve` before index.ts is imported,
  // so its top-level `Deno.serve(async (req) => {...})` call captures cleanly.
  (globalThis as unknown as { Deno: { env: unknown; serve: (h: Handler) => void } }).Deno = {
    env: (globalThis as unknown as { Deno: { env: unknown } }).Deno.env,
    serve: (h: Handler) => {
      handler = h;
    },
  };

  await import("../../supabase/functions/parse-inbound-bill/index.ts");
});

const RESEND_EMAIL_ID = "re_test_email_123";

function resendReceivingUrl(path: string): string {
  return `https://api.resend.com/emails/receiving/${path}`;
}

const GEMINI_URL_FRAGMENT = "generativelanguage.googleapis.com";

describe("parse-inbound-bill webhook (real production handler, mocked fetch + Supabase client)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockCreateClient.mockClear();
    emailInboxUpsert.mockClear();
    entitiesSelect.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a request with an invalid svix-signature with 401, before touching Resend or Supabase", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: RESEND_EMAIL_ID } });
    const req = new Request("https://example.functions.supabase.co/parse-inbound-bill", {
      method: "POST",
      headers: { "content-type": "application/json", ...svixHeaders(WEBHOOK_SECRET, body, false) },
      body,
    });

    const res = await handler(req);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid signature");
    expect(fetch).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("accepts a validly signed payload, fetches the email from Resend, classifies it, and logs the outcome", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: RESEND_EMAIL_ID } });

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === resendReceivingUrl(RESEND_EMAIL_ID)) {
        // A text-only inbound email (no attachment) — Resend's real GET /emails/receiving/{id}
        // response shape, per index.ts's own ResendReceivedEmail interface.
        return new Response(
          JSON.stringify({
            id: RESEND_EMAIL_ID,
            from: "newsletter@example.com",
            subject: "Just checking in",
            text: "Thanks for being a customer! No action needed.",
            attachments: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes(GEMINI_URL_FRAGMENT)) {
        // Classified as "other" with no attachment -> router.ts's silent no-op skip path.
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ document_type: "other", confidence: 0.92 }) }] } }] }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    const req = new Request("https://example.functions.supabase.co/parse-inbound-bill", {
      method: "POST",
      headers: { "content-type": "application/json", ...svixHeaders(WEBHOOK_SECRET, body, true) },
      body,
    });

    const res = await handler(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ results: [{ ok: true }] });

    // "Triggers storage": every processed job gets a row in email_inbox_log regardless of outcome
    // (this app's ai_intake_proposals table, by contrast, only ever gets a row on a genuine bill/
    // lease/etc. match — an "other"-classified, no-attachment email correctly does NOT create one).
    expect(emailInboxUpsert).toHaveBeenCalledTimes(1);
    expect(emailInboxUpsert.mock.calls[0][0]).toMatchObject({
      emailId: RESEND_EMAIL_ID,
      status: "skipped",
      documentType: "other",
    });
  });

  it("rejects a non-POST request with 405 without needing a signature at all", async () => {
    const res = await handler(new Request("https://example.functions.supabase.co/parse-inbound-bill", { method: "GET" }));
    expect(res.status).toBe(405);
  });
});
