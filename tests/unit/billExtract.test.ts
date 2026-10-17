import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

const { extractBill, extractBillFromStored } = await import("@/lib/billExtract");

describe("extractBill", () => {
  beforeEach(() => invoke.mockReset());

  it("returns the extracted fields", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, vendor: "Sydney Water", amount: 441.59 },
      error: null,
    });
    await expect(extractBill("AAAA", "bill.pdf", "application/pdf")).resolves.toMatchObject({
      amount: 441.59,
    });
    expect(invoke).toHaveBeenCalledWith("extract-bill", {
      body: { fileBase64: "AAAA", fileName: "bill.pdf", mimeType: "application/pdf" },
    });
  });

  // The Gemini-overloaded case: the function's own readable message reaches the landlord.
  it("surfaces the function's readable error, not a generic one", async () => {
    const context = new Response(
      JSON.stringify({
        error: "Google's AI reader is overloaded right now. Wait a minute and try again.",
      }),
      {
        status: 500,
      },
    );
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context }),
    });
    await expect(extractBill("AAAA", "bill.pdf", "application/pdf")).rejects.toThrow(/overloaded/);
  });

  it("throws when the reader says it couldn't read the bill", async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: "Unreadable" }, error: null });
    await expect(extractBill("AAAA", "bill.pdf", "application/pdf")).rejects.toThrow("Unreadable");
  });
});

describe("extractBillFromStored", () => {
  beforeEach(() => invoke.mockReset());

  it("re-reads an attached inline document", async () => {
    invoke.mockResolvedValue({ data: { ok: true, amount: 1 }, error: null });
    await extractBillFromStored("bill.pdf", btoa("%PDF-1.4 test"));
    const body = invoke.mock.calls[0][1].body;
    expect(atob(body.fileBase64)).toBe("%PDF-1.4 test");
    expect(body.mimeType).toBe("application/pdf");
  });

  it("fails clearly with nothing attached", async () => {
    await expect(extractBillFromStored("bill.pdf", undefined)).rejects.toThrow(/Couldn't load/);
  });
});
