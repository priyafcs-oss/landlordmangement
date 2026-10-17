import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const { aiFileProblem, invokeExtract, storedToExtractFile } = await import("@/lib/aiExtract");
const { useAiExtraction } = await import("@/lib/useAiExtraction");
const { toast } = await import("sonner");

const pdf = (name = "bill.pdf", size = 10) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

describe("invokeExtract", () => {
  beforeEach(() => invoke.mockReset());

  it("returns the fields on success", async () => {
    invoke.mockResolvedValue({ data: { ok: true, vendor: "Sydney Water" }, error: null });
    await expect(
      invokeExtract("extract-bill", {
        fileBase64: "AA",
        fileName: "b.pdf",
        mimeType: "application/pdf",
      }),
    ).resolves.toMatchObject({
      vendor: "Sydney Water",
    });
  });

  // The Gemini-overloaded case: the function's readable message, not a generic one.
  it("surfaces the function's readable error", async () => {
    const context = new Response(
      JSON.stringify({ error: "Google's AI reader is overloaded right now." }),
      { status: 500 },
    );
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("non-2xx"), { context }),
    });
    await expect(
      invokeExtract("extract-loan-document", {
        fileBase64: "AA",
        fileName: "l.pdf",
        mimeType: "application/pdf",
      }),
    ).rejects.toThrow(/overloaded/);
  });

  it("uses the caller's fallback when the reader gives no reason", async () => {
    invoke.mockResolvedValue({ data: { ok: false }, error: null });
    await expect(
      invokeExtract(
        "extract-depreciation-report",
        { fileBase64: "AA", fileName: "r.pdf", mimeType: "application/pdf" },
        "Couldn't read this report",
      ),
    ).rejects.toThrow("Couldn't read this report");
  });
});

describe("aiFileProblem", () => {
  it("rejects non-PDF/image files and oversized files", () => {
    expect(aiFileProblem(pdf())).toBeNull();
    expect(aiFileProblem(new File(["a,b"], "rent.csv", { type: "text/csv" }))).toMatch(
      /isn't a PDF or image/,
    );
    expect(aiFileProblem(pdf("big.pdf", 13 * 1024 * 1024))).toMatch(/can only handle files up to/);
  });
});

describe("storedToExtractFile", () => {
  it("re-reads an inline attachment", async () => {
    const f = await storedToExtractFile("bill.pdf", btoa("%PDF-1.4"));
    expect(atob(f.fileBase64)).toBe("%PDF-1.4");
    expect(f.mimeType).toBe("application/pdf");
  });

  it("fails clearly with nothing attached", async () => {
    await expect(storedToExtractFile("bill.pdf", undefined)).rejects.toThrow(/Couldn't load/);
  });
});

describe("useAiExtraction", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it("attaches the file, applies the result and reports ok", async () => {
    invoke.mockResolvedValue({ data: { ok: true, amount: 441.59 }, error: null });
    const onAttach = vi.fn();
    const apply = vi.fn(() => ({ empty: false }));
    const { result } = renderHook(() =>
      useAiExtraction<{ amount: number }>({ fn: "extract-bill", onAttach, apply }),
    );
    await act(() => result.current.extract(pdf()));
    expect(onAttach).toHaveBeenCalledWith("bill.pdf", expect.any(String));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 441.59 }),
      expect.anything(),
    );
    expect(result.current.status).toBe("ok");
    expect(result.current.busy).toBe(false);
  });

  // A failed read used to leave no way to retry without uploading the file again.
  it("goes to failed on an error, then a reread succeeds", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: false, error: "overloaded" }, error: null });
    const { result } = renderHook(() =>
      useAiExtraction({ fn: "extract-bill", apply: () => ({ empty: false }) }),
    );
    await act(() => result.current.extract(pdf()));
    expect(result.current.status).toBe("failed");
    expect(toast.error).toHaveBeenCalledWith("overloaded");
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await act(() => result.current.reread("bill.pdf", btoa("%PDF")));
    expect(result.current.status).toBe("ok");
  });

  it("ignores a read that finishes after reset (dialog closed mid-read)", async () => {
    let resolve!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => (resolve = r)));
    const apply = vi.fn(() => ({ empty: false }));
    const { result } = renderHook(() => useAiExtraction({ fn: "extract-bill", apply }));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.extract(pdf());
    });
    act(() => result.current.reset());
    await act(async () => {
      resolve({ data: { ok: true }, error: null });
      await pending;
    });
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("refuses a wrong file type without calling the reader", async () => {
    const { result } = renderHook(() =>
      useAiExtraction({ fn: "extract-bill", apply: () => ({ empty: false }) }),
    );
    await act(() =>
      result.current.extract(new File(["x"], "notes.docx", { type: "application/msword" })),
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
