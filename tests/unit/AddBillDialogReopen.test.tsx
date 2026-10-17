import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AiIntakeProposal } from "@/lib/types";

const state = {
  properties: [{ id: "p1", address: "10 Facer Ct Castle Hill" }],
  providers: [],
  providerProperties: [],
  tenants: [],
  bills: [],
  expenses: [],
  assets: [],
};
const noop = () => undefined;
vi.mock("@/lib/store", () => ({
  useStore: () => ({
    state,
    addBill: noop,
    addProvider: () => "prov",
    updateProvider: noop,
    ensureProviderProperty: noop,
    updateProperty: noop,
    addInvoice: noop,
    updateExpense: noop,
    markProposalApplied: noop,
    dismissProposal: noop,
    refreshOne: async () => undefined,
  }),
}));

const { AddBillDialog } = await import("@/components/AddBillDialog");

const proposal = {
  id: "prop_1",
  kind: "bill",
  status: "pending",
  propertyId: "p1",
  providerName: "Sydney Water",
  payload: {
    amount: 441.59,
    dueDate: "2026-11-06",
    billCategory: "Water",
    lineItems: [{ description: "Water Bill", amount: 441.59 }],
  },
} as unknown as AiIntakeProposal;

let setOpenOutside: (o: boolean) => void = noop;
function Harness() {
  const [open, setOpen] = useState(true);
  setOpenOutside = setOpen;
  return <AddBillDialog initialProposal={proposal} open={open} onOpenChange={setOpen} />;
}

// The review dialog stays mounted in its list row. Closing it reset the form, and the fill-from-
// proposal effect only re-ran when the proposal id changed — so reopening the same bill showed
// a blank form.
describe("AddBillDialog reopened for the same proposal", () => {
  it("shows the proposal's details again", () => {
    render(<Harness />);
    expect(screen.getByDisplayValue("Sydney Water")).toBeTruthy();
    // Close with the dialog's own X, the way a landlord does.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => setOpenOutside(true));
    expect(screen.getByDisplayValue("Sydney Water")).toBeTruthy();
    expect(screen.getByDisplayValue("441.59")).toBeTruthy();
  });
});
