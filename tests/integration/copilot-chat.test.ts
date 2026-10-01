/**
 * Integration test for the REAL copilot-chat edge function (imported and invoked directly, same
 * Deno.serve-capture approach as tests/integration/resend-webhook.test.ts — see that file's doc
 * comment for why). Covers the behavior that changed in this session: the function now returns
 * structured { answer, steps } via callGeminiJSON (shared with the document-extraction pipeline)
 * instead of free text, which also gives it that pipeline's timeout/retry ceiling for free
 * (already covered generally by tests/unit/gemini-parser.test.ts, since it's the same function —
 * this file only covers copilot-chat's own request/response shape and auth handling).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { mockSupabaseClient, mockCreateClient, mockGetUser } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockSupabaseClient = { auth: { getUser: mockGetUser } } as unknown as SupabaseClient;
  return { mockSupabaseClient, mockCreateClient: vi.fn(() => mockSupabaseClient), mockGetUser };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mockCreateClient }));

type Handler = (req: Request) => Promise<Response> | Response;
let handler: Handler;

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";

  (globalThis as unknown as { Deno: { env: unknown; serve: (h: Handler) => void } }).Deno = {
    env: (globalThis as unknown as { Deno: { env: unknown } }).Deno.env,
    serve: (h: Handler) => {
      handler = h;
    },
  };

  await import("../../supabase/functions/copilot-chat/index.ts");
});

function authedRequest(body: unknown): Request {
  return new Request("https://example.functions.supabase.co/copilot-chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

function geminiResponse(parsedJson: unknown): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(parsedJson) }] } }] }), { status: 200 });
}

describe("copilot-chat (real production handler, mocked fetch + Supabase client)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockGetUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a request with no Authorization header with 401, before calling Gemini", async () => {
    const res = await handler(
      new Request("https://example.functions.supabase.co/copilot-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-POST request with 405", async () => {
    const res = await handler(new Request("https://example.functions.supabase.co/copilot-chat", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("rejects a request with no messages with 400", async () => {
    const res = await handler(authedRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it("returns a plain-text answer for a question, with steps null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(geminiResponse({ answer: "You have 2 tenants in arrears.", steps: null }));

    const res = await handler(
      authedRequest({ messages: [{ role: "system", content: "PORTFOLIO_JSON: {}" }, { role: "user", content: "Who is in arrears?" }] }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ answer: "You have 2 tenants in arrears.", steps: null });
  });

  it("returns an ordered step plan for an action request, with answer null", async () => {
    const steps = [
      { stepId: "step1", type: "create_property", summary: "Create property at 5 Smith St", address: "5 Smith St" },
      { stepId: "step2", type: "create_tenant", summary: "Add tenant Jane at $500/week", propertyRef: "$step1", tenantName: "Jane", rentAmount: 500 },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(geminiResponse({ answer: null, steps }));

    const res = await handler(
      authedRequest({
        messages: [
          { role: "system", content: "PORTFOLIO_JSON: {}" },
          { role: "user", content: "Create a property at 5 Smith St and add tenant Jane paying $500/week" },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.answer).toBeNull();
    expect(json.steps).toEqual(steps);
  });

  it("flattens the messages array into a single Gemini text part, not a structured chat-turns payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(geminiResponse({ answer: "ok", steps: null }));

    await handler(
      authedRequest({
        messages: [
          { role: "system", content: "SYSTEM_INSTRUCTIONS" },
          { role: "user", content: "first turn" },
          { role: "assistant", content: "first reply" },
          { role: "user", content: "second turn" },
        ],
      }),
    );

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    const text = sentBody.contents[0].parts[0].text as string;
    expect(text).toContain("SYSTEM_INSTRUCTIONS");
    expect(text).toContain("first turn");
    expect(text).toContain("first reply");
    expect(text).toContain("second turn");
  });
});
