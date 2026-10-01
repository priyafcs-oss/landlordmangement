// Imports real Deno-runtime source under Node — excluded from tsc/editor type-checking via
// tsconfig.json's `exclude`; see tests/setup.edge.ts's doc comment for why.
/**
 * Unit tests for the REAL AI document-parsing functions this app runs in production —
 * supabase/functions/parse-inbound-bill/{gemini,classify,core-parser}.ts — imported directly, not
 * reimplemented. Two corrections from a generic "mock the Gemini SDK" brief, worth calling out:
 *
 * 1. There is no Gemini SDK anywhere in this codebase — gemini.ts talks to
 *    https://generativelanguage.googleapis.com directly via plain `fetch()` (see that file's own
 *    doc comment). So "mocking the SDK" here means stubbing `globalThis.fetch`, which is both more
 *    honest to the real code and exercises the actual retry/model-fallback logic these tests cover.
 * 2. These files run on Deno in production (Supabase Edge Functions), not Node — but the specific
 *    functions under test here only touch `Deno.env.get`, so tests/setup.edge.ts's narrow shim is
 *    enough to run the genuine production code under Vitest. See vitest.config.ts's "edge" project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyDocument } from "../../supabase/functions/parse-inbound-bill/classify.ts";
import { extractBillFields } from "../../supabase/functions/parse-inbound-bill/core-parser.ts";
import type { NormalizedBillInput } from "../../supabase/functions/parse-inbound-bill/types.ts";

const SAMPLE_BILL_INPUT: NormalizedBillInput = {
  fromEmail: "billing@sydneywater.com.au",
  subject: "Your water bill is ready",
  // A real attachment would be a base64-encoded PDF; Gemini reads it as inlineData and this test
  // never actually decodes it (fetch is mocked), so any non-empty string exercises the same code
  // path as a genuine PDF without needing a real binary fixture.
  pdfBase64: "JVBERi0xLjQKJdP0zOEK...", // truncated placeholder PDF bytes
  pdfFileName: "sydney-water-bill.pdf",
  attachmentMimeType: "application/pdf",
};

/** Shapes a fetch Response the way gemini.ts's callGeminiJSON expects: a Gemini generateContent
 * response whose first candidate's text part is a JSON string matching the caller's schema. */
function geminiResponse(parsedJson: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(parsedJson) }] } }] } : "server error"),
    { status },
  );
}

describe("Gemini document parsing (real production code, mocked fetch)", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("classifies a document into a structured { document_type, confidence } result", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(geminiResponse({ document_type: "bill", confidence: 0.97 }));

    const result = await classifyDocument(SAMPLE_BILL_INPUT, ["Smith Family Trust"]);

    expect(result).toEqual({ document_type: "bill", confidence: 0.97 });
    // The model URL and API key are both real request details worth asserting on, not just the
    // parsed result — confirms the default model candidate and key are actually wired through.
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain("gemini-3.6-flash:generateContent?key=test-gemini-key");
  });

  it("extracts raw bill text/attachment into a structured transaction-like object", async () => {
    // Field names below are this app's real ParsedBillFields shape (vendor/amount/due_date/
    // bill_category), the closest real equivalent to a generic { date, amount, category, supplier }
    // shape — supplier -> vendor, date -> due_date, category -> bill_category.
    vi.mocked(fetch).mockResolvedValueOnce(
      geminiResponse({
        vendor: "Sydney Water",
        amount: 245.6,
        due_date: "2026-10-15",
        property_address: "12 Example St, Sydney NSW 2000",
        bpay_biller_code: "12345",
        bpay_reference: "987654321",
        reference_number: null,
        ato_category: "Immediate Deduction",
        bill_category: "Water",
        expense_category: "Water Rates",
        future_instalments: [],
        vendor_email: null,
        vendor_phone: null,
        vendor_website: null,
        vendor_abn: null,
        vendor_address: null,
        line_items: [{ description: "Water usage", amount: 245.6 }],
        addressed_to: null,
        confidence: 0.95,
      }),
    );

    const parsed = await extractBillFields(SAMPLE_BILL_INPUT);

    expect(parsed).toMatchObject({
      vendor: "Sydney Water", // supplier
      amount: 245.6,
      due_date: "2026-10-15", // date
      bill_category: "Water", // category
    });
  });

  it("throws a clear error instead of silently producing garbage when Gemini returns no content (an unreadable/malformed document)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));

    await expect(extractBillFields(SAMPLE_BILL_INPUT)).rejects.toThrow("Gemini returned no content");
  });

  it("does not retry and fails fast on a genuine 4xx (not 404/429) — a real bug, not a transient failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    await expect(extractBillFields(SAMPLE_BILL_INPUT)).rejects.toThrow("Gemini request failed: 400");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries the same model on a 5xx, then succeeds", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("server error", { status: 503 }))
      .mockResolvedValueOnce(geminiResponse({ document_type: "bill", confidence: 0.9 }));

    const resultPromise = classifyDocument(SAMPLE_BILL_INPUT);
    // The retry loop sleeps 1000ms * (attempt + 1) between attempts (gemini.ts's own backoff) —
    // advance fake time so the test doesn't actually wait a full second.
    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toEqual({ document_type: "bill", confidence: 0.9 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the next model candidate when the primary model is retired (404) or over quota (429)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(geminiResponse({ document_type: "lease_agreement", confidence: 0.88 }));

    const result = await classifyDocument(SAMPLE_BILL_INPUT);

    expect(result.document_type).toBe("lease_agreement");
    const [firstUrl] = vi.mocked(fetch).mock.calls[0] as [string];
    const [secondUrl] = vi.mocked(fetch).mock.calls[1] as [string];
    expect(firstUrl).toContain("gemini-3.6-flash");
    expect(secondUrl).toContain("gemini-3.5-flash-lite");
  });

  it("throws when GEMINI_API_KEY isn't configured, rather than sending a request with no key", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(classifyDocument(SAMPLE_BILL_INPUT)).rejects.toThrow("GEMINI_API_KEY is not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});
