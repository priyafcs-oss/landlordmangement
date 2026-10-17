import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, fireEvent } from "@testing-library/react";

const store = {
  state: {
    bills: [
      {
        id: "bill_1",
        propertyId: "p1",
        providerName: "Sydney Water",
        amount: 441.59,
        dueDate: "2026-11-06",
        bpayReference: "31127450000",
        status: "Unpaid",
      },
    ],
    expenses: [
      {
        id: "ex_1",
        propertyId: "p1",
        itemName: "Plumber",
        cost: 220,
        date: "2026-10-01",
        referenceNumber: "INV-7",
      },
    ],
  },
  updateExpense: vi.fn(),
  markProposalApplied: vi.fn(),
  removeOne: vi.fn(),
  refreshOne: vi.fn(async () => undefined),
};
vi.mock("@/lib/store", () => ({ useStore: () => store }));
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const { useDuplicateGuard } = await import("@/components/DuplicateWarningDialog");
const { useReparse } = await import("@/lib/useReparse");
const { documentLayout } = await import("@/lib/documentLayout");

describe("useDuplicateGuard (bill + transaction save)", () => {
  beforeEach(() => vi.clearAllMocks());

  // AddTransactionDialog never passed a BPAY reference, so a transaction whose reference is a
  // bill's BPAY number wasn't caught as a duplicate of that bill.
  it("catches a transaction whose reference is an existing bill's BPAY reference", () => {
    const { result } = renderHook(() =>
      useDuplicateGuard({ onSaveAnyway: vi.fn(), onAttached: vi.fn() }),
    );
    let dup = false;
    act(() => {
      dup = result.current.guard({
        propertyId: "p1",
        vendorOrDescription: "Water",
        amount: 441.59,
        date: "2026-11-01",
        referenceNumber: "31127450000",
        bpayReference: "31127450000",
      });
    });
    expect(dup).toBe(true);
  });

  it("lets a genuinely new record through", () => {
    const { result } = renderHook(() =>
      useDuplicateGuard({ onSaveAnyway: vi.fn(), onAttached: vi.fn() }),
    );
    let dup = true;
    act(() => {
      dup = result.current.guard({
        propertyId: "p1",
        vendorOrDescription: "Electrician",
        amount: 99,
        date: "2026-10-10",
      });
    });
    expect(dup).toBe(false);
  });

  it("attaches the file to the matched transaction instead of saving a duplicate", () => {
    const onAttached = vi.fn();
    const onSaveAnyway = vi.fn();
    function Harness() {
      const g = useDuplicateGuard({
        onSaveAnyway,
        onAttached,
        file: { fileName: "inv.pdf", fileData: "AAAA" },
        proposalId: "prop_1",
        propertyId: "p1",
      });
      return (
        <>
          <button
            onClick={() =>
              g.guard({
                propertyId: "p1",
                vendorOrDescription: "Plumber",
                amount: 220,
                date: "2026-10-01",
                referenceNumber: "INV-7",
              })
            }
          >
            save
          </button>
          {g.dialog}
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("save"));
    fireEvent.click(screen.getByRole("button", { name: /attach/i }));
    expect(store.updateExpense).toHaveBeenCalledWith("ex_1", {
      invoiceFileName: "inv.pdf",
      invoiceFileData: "AAAA",
    });
    expect(store.markProposalApplied).toHaveBeenCalledWith("prop_1", { propertyId: "p1" });
    expect(onAttached).toHaveBeenCalled();
    expect(onSaveAnyway).not.toHaveBeenCalled();
  });
});

describe("useReparse (rent statement + unclassified cards)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("swaps the old proposal for the new one", async () => {
    invoke.mockResolvedValue({ data: { ok: true, proposalId: "prop_new" }, error: null });
    const { result } = renderHook(() => useReparse("prop_old"));
    let ok = false;
    await act(async () => {
      ok = await result.current.reparse("rent_statement", "done");
    });
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("reparse-document", {
      body: { proposalId: "prop_old", documentType: "rent_statement" },
    });
    expect(store.removeOne).toHaveBeenCalledWith("aiProposals", "prop_old");
    expect(store.refreshOne).toHaveBeenCalledWith("aiProposals", "prop_new");
  });

  it("keeps the proposal when the re-read fails", async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: "Not a lease" }, error: null });
    const { result } = renderHook(() => useReparse("prop_old"));
    let ok = true;
    await act(async () => {
      ok = await result.current.reparse("lease", "done");
    });
    expect(ok).toBe(false);
    expect(store.removeOne).not.toHaveBeenCalled();
  });
});

describe("documentLayout", () => {
  it("grows the whole dialog when the document is enlarged", () => {
    expect(documentLayout(false).dialog).toContain("max-w-5xl");
    expect(documentLayout(true).dialog).toContain("w-[95vw]");
    expect(documentLayout(true).left).toContain("overflow-y-auto");
    expect(documentLayout(false, { cols: "md:grid-cols-2" }).grid).toContain("md:grid-cols-2");
  });
});
