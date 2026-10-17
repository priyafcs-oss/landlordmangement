import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const upload = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    storage: { from: () => ({ upload }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const { countStorageFiles, uploadDocumentBase64 } = await import("@/lib/files");
const { plural } = await import("@/lib/format");
const { toast } = await import("sonner");

// When Drive's link lapsed, uploads quietly fell back to app storage for a week and nobody could
// tell — now the landlord is warned, and Settings counts what's left in app storage to move.
describe("Drive upload fallback", () => {
  beforeEach(() => {
    invoke.mockReset();
    upload.mockReset().mockResolvedValue({ error: null });
    vi.mocked(toast.warning).mockClear();
  });

  it("warns when a connected Drive couldn't take the file", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("x"), response: { status: 409 } });
    const marker = await uploadDocumentBase64("JVBERg==", "bill.pdf");
    expect(marker.startsWith("storage:u1/")).toBe(true);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when Drive was never connected", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("x"), response: { status: 422 } });
    await uploadDocumentBase64("JVBERg==", "bill.pdf");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("uses Drive when it works", async () => {
    invoke.mockResolvedValue({
      data: { marker: "gdrive:abc" },
      error: null,
      response: { status: 200 },
    });
    expect(await uploadDocumentBase64("JVBERg==", "bill.pdf")).toBe("gdrive:abc");
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("countStorageFiles", () => {
  it("counts each distinct storage: file once, anywhere in the portfolio", () => {
    const state = {
      bills: [
        { sourceFileData: "storage:u1/a.pdf" },
        { sourceFileData: "storage:u1/a.pdf" },
        { sourceFileData: "gdrive:x" },
      ],
      tenants: [{ documents: [{ fileData: "storage:u1/b.pdf" }] }],
      settings: { name: "storage room" },
    };
    expect(countStorageFiles(state)).toBe(2);
    expect(countStorageFiles({})).toBe(0);
  });
});

describe("plural", () => {
  it("pluralises by count", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(3, "file")).toBe("3 files");
  });
});
