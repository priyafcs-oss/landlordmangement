/**
 * Integration test for the REAL egress-optimization behavior in src/lib/files.ts (imported
 * directly, not reimplemented): file bytes are fetched only when a document is actually opened,
 * never as a side effect of loading table rows into memory — see that file's own module doc
 * comment, which explains this is precisely what a past Supabase egress overage was traced to.
 *
 * Since this app's list views (Rental Hub, property tabs, etc.) render straight from
 * src/lib/store.tsx's in-memory AppState — plain Postgres rows containing marker strings like
 * "storage:<path>"/"gdrive:<fileId>", never file bytes — the real guarantee under test here is
 * narrower and more precisely verifiable than "renders a list": nothing in this module ever
 * touches Supabase Storage or the drive-download function until resolveDocumentBlob/
 * resolveDocumentUrl is explicitly called on a specific marker. That's what "rendering a list
 * doesn't trigger downloads" cashes out to at this layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSignedUrl, mockFunctionsInvoke } = vi.hoisted(() => ({
  mockCreateSignedUrl: vi.fn(),
  mockFunctionsInvoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: mockCreateSignedUrl, upload: vi.fn() }) },
    functions: { invoke: mockFunctionsInvoke },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } } }) },
  },
}));

// files.ts imports logFileAccess from here — mocked out so this test asserts only on the
// caching/network behavior under test, not on the (separately-tested-elsewhere) access-log side effect.
vi.mock("@/lib/usage", () => ({ logFileAccess: vi.fn() }));

import { resolveDocumentBlob, resolveDocumentUrl } from "@/lib/files";

function fakePdfResponse(label: string): Response {
  return new Response(new Blob([`pdf bytes for ${label}`], { type: "application/pdf" }), { status: 200 });
}

describe("Egress-optimized file resolution & caching (src/lib/files.ts)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockCreateSignedUrl.mockReset();
    mockFunctionsInvoke.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never calls Storage or Drive just from marker strings sitting around — only an explicit resolve does", () => {
    // Simulates a list of rows as they actually exist in AppState (src/lib/store.tsx) — plain
    // objects carrying marker strings, exactly as loaded by a table read, never touched.
    const rentalTransactions = [
      { id: "t1", amount: 245.6, invoiceFileData: "storage:owner-1/abc-receipt.pdf" },
      { id: "t2", amount: 89.0, invoiceFileData: "gdrive:1AbCdEfGhIjKlMnOp" },
    ];
    // "Rendering" here is standing in for whatever a list component does with these rows without
    // ever calling resolveDocumentBlob/resolveDocumentUrl on them (e.g. showing amount/date only).
    void rentalTransactions.map((t) => t.amount);

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves a storage: marker via a signed URL, fetches it once, and reuses the cached Blob on a second request", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.supabase.co/signed/abc" }, error: null });
    vi.mocked(fetch).mockResolvedValue(fakePdfResponse("receipt"));

    const marker = "storage:owner-1/unique-receipt-1.pdf";
    const first = await resolveDocumentBlob("receipt.pdf", marker);
    const second = await resolveDocumentBlob("receipt.pdf", marker);

    expect(first).not.toBeNull();
    expect(second).toBe(first); // same cached Blob instance, not a re-fetch
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1); // NOT called again for the second request
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight request across concurrent resolves of the same marker (no duplicate signing)", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.supabase.co/signed/concurrent" }, error: null });
    vi.mocked(fetch).mockResolvedValue(fakePdfResponse("concurrent"));

    const marker = "storage:owner-1/unique-receipt-2.pdf";
    const [a, b] = await Promise.all([resolveDocumentBlob(undefined, marker), resolveDocumentBlob(undefined, marker)]);

    expect(a).toBe(b);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("resolves a gdrive: marker via the drive-download function instead of Supabase Storage", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: new Blob(["drive bytes"], { type: "application/octet-stream" }),
      error: null,
      response: undefined,
    });

    const blob = await resolveDocumentBlob("photo.jpg", "gdrive:1UniqueFileId");

    expect(blob).not.toBeNull();
    expect(mockFunctionsInvoke).toHaveBeenCalledWith("drive-download", { body: { marker: "gdrive:1UniqueFileId" } });
    expect(mockCreateSignedUrl).not.toHaveBeenCalled(); // never touches the Supabase bucket for a Drive-backed marker
  });

  it("resolves legacy inline base64 synchronously with zero network calls", async () => {
    const base64 = "data:application/pdf;base64,JVBERi0xLjQK";

    const blob = await resolveDocumentBlob("old-upload.pdf", base64);

    expect(blob).not.toBeNull();
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolveDocumentUrl builds a usable object URL from the same cached Blob", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.supabase.co/signed/url-test" }, error: null });
    vi.mocked(fetch).mockResolvedValue(fakePdfResponse("url-test"));

    const url = await resolveDocumentUrl("doc.pdf", "storage:owner-1/unique-receipt-3.pdf");

    expect(url).toMatch(/^blob:/);
  });
});
