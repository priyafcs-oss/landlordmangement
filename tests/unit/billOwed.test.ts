import { describe, expect, it } from "vitest";
import { billOwed, isBillOverdue } from "@/lib/calculations";

const TODAY = "2026-10-17";

describe("billOwed", () => {
  it("is the full amount while unpaid and nothing once paid", () => {
    expect(billOwed({ amount: 441.59, status: "Unpaid" })).toBe(441.59);
    expect(billOwed({ amount: 441.59, status: "Paid", paidAmount: 441.59 })).toBe(0);
  });

  // Dashboards and forecasts summed raw amount, overstating a part-paid bill.
  it("subtracts what's been paid on a partial instalment", () => {
    expect(billOwed({ amount: 600, status: "Partial", paidAmount: 250 })).toBe(350);
  });

  it("ignores a stray paidAmount unless the bill is Partial", () => {
    expect(billOwed({ amount: 600, status: "Unpaid", paidAmount: 250 })).toBe(600);
  });
});

describe("isBillOverdue", () => {
  it("flags unpaid and part-paid bills past due", () => {
    expect(isBillOverdue({ amount: 100, status: "Unpaid", dueDate: "2026-10-01" }, TODAY)).toBe(
      true,
    );
    // The old status === "Unpaid" check missed this one.
    expect(
      isBillOverdue(
        { amount: 100, status: "Partial", paidAmount: 40, dueDate: "2026-10-01" },
        TODAY,
      ),
    ).toBe(true);
  });

  it("doesn't flag paid, not-yet-due, or due-today bills", () => {
    expect(isBillOverdue({ amount: 100, status: "Paid", dueDate: "2026-10-01" }, TODAY)).toBe(
      false,
    );
    expect(isBillOverdue({ amount: 100, status: "Unpaid", dueDate: "2026-11-01" }, TODAY)).toBe(
      false,
    );
    expect(isBillOverdue({ amount: 100, status: "Unpaid", dueDate: TODAY }, TODAY)).toBe(false);
  });
});
