import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PropertyBill } from "@/lib/types";

const store = {
  markBillPaid: vi.fn(() => ({ status: "Paid" })),
  unmarkBillPaid: vi.fn(),
  deleteBill: vi.fn(),
};
vi.mock("@/lib/store", () => ({ useStore: () => store }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { MarkBillPaidDialog, BillPaymentControl } = await import("@/components/MarkBillPaidDialog");

const bill = {
  id: "b1",
  billType: "Water",
  amount: 441.59,
  dueDate: "2026-11-06",
  status: "Unpaid",
} as PropertyBill;

describe("bill payment controls", () => {
  // Opened controlled (the Bills board's menu), the dialog never reset, so a second open kept the
  // amount typed the first time.
  it("resets its fields every time it opens, even when opened controlled", () => {
    let setOpen: (o: boolean) => void = () => undefined;
    function Harness() {
      const [open, set] = useState(true);
      setOpen = set;
      return <MarkBillPaidDialog bill={bill} open={open} onOpenChange={set} />;
    }
    render(<Harness />);
    const amount = screen.getByDisplayValue("441.59");
    fireEvent.change(amount, { target: { value: "100" } });
    act(() => setOpen(false));
    act(() => setOpen(true));
    expect(screen.getByDisplayValue("441.59")).toBeTruthy();
  });

  it("offers Pay remainder and Unpay on a part-paid bill", () => {
    render(<BillPaymentControl bill={{ ...bill, status: "Partial", paidAmount: 200 }} />);
    expect(screen.getByText(/Pay remainder/)).toBeTruthy();
    expect(screen.getByText(/241.59 still owed/)).toBeTruthy();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByText("Unpay"));
    expect(store.unmarkBillPaid).toHaveBeenCalledWith("b1");
  });

  it("opens the payment dialog rather than marking paid straight away", () => {
    render(<BillPaymentControl bill={bill} />);
    fireEvent.click(screen.getByText("Mark paid"));
    expect(store.markBillPaid).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("441.59")).toBeTruthy();
  });
});
