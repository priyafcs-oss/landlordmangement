/**
 * The shared request handler behind every extract-* edge function (supabase/functions/_shared/
 * extractHandler.ts), run for real under Node with the Supabase client mocked. Each extract-*
 * function used to carry its own copy of this, and none of them checked the caller was signed in.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}));

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
const extract = vi.fn();

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  const { handleExtract } = await import("../../supabase/functions/_shared/extractHandler.ts");
  handle = handleExtract({ tag: "extract-test", subjectPrefix: "Test upload", extract });
});

const body = { fileBase64: "JVBERi0=", fileName: "bill.pdf", mimeType: "application/pdf" };
function req(payload: unknown, auth = true): Request {
  return new Request("https://example.functions.supabase.co/extract-test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer user-token" } : {}),
    },
    body: JSON.stringify(payload),
  });
}

describe("handleExtract", () => {
  beforeEach(() => {
    extract.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  });

  it("rejects a caller with no session (401) without calling the AI", async () => {
    const res = await handle(req(body, false));
    expect(res.status).toBe(401);
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects an invalid session token (401)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("bad jwt") });
    expect((await handle(req(body))).status).toBe(401);
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types (422) and oversize files (413)", async () => {
    expect((await handle(req({ ...body, mimeType: "text/csv" }))).status).toBe(422);
    expect(
      (await handle(req({ ...body, fileBase64: "A".repeat(16 * 1024 * 1024 + 1) }))).status,
    ).toBe(413);
    expect((await handle(req({ fileName: "x.pdf" }))).status).toBe(400);
  });

  it("returns the extraction as { ok: true, ...fields }", async () => {
    extract.mockResolvedValue({ vendor: "Sydney Water", amount: 441.59 });
    const res = await handle(req(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, vendor: "Sydney Water", amount: 441.59 });
    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Test upload: bill.pdf", pdfBase64: body.fileBase64 }),
    );
  });

  it("passes the extractor's readable error through (500)", async () => {
    extract.mockRejectedValue(
      new Error("Google's AI reader is overloaded right now. Wait a minute and try again."),
    );
    const res = await handle(req(body));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/overloaded/);
  });

  it("answers the CORS preflight", async () => {
    const res = await handle(new Request("https://x/extract-test", { method: "OPTIONS" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
