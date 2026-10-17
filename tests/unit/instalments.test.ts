import { describe, expect, it } from "vitest";
import {
  instalmentBills,
  instalmentLabel,
  newInstalmentRow,
  sharedBillFields,
  validateInstalments,
} from "@/lib/instalments";
import type { PropertyBill } from "@/lib/types";

const saved: PropertyBill = {
  id: "bill_1",
  created_at: "2026-09-01T00:00:00Z",
  propertyId: "p1",
  unitId: "u1",
  billType: "Council Rates",
  category: "Council Rates",
  taxCategory: "Immediate Deduction",
  providerId: "prov_1",
  providerName: "The Hills Shire",
  issueDate: "2026-08-01",
  notes: "rates",
  source: "Upload",
  billGroupId: "bg_1",
  label: "Instalment 1",
  amount: 558.13,
  dueDate: "2026-08-31",
  status: "Paid",
  paidDate: "2026-08-30",
  paidAmount: 558.13,
  emailMessageId: "msg-1",
};

describe("instalmentBills", () => {
  // BillDetailDialog's own copy left these off a newly added instalment, so paying it later
  // posted an expense with no tax category.
  it("copies every shared field onto a new instalment", () => {
    const [b] = instalmentBills(
      sharedBillFields(saved),
      [newInstalmentRow(2, { dueDate: "2026-11-30", amount: "557.90" })],
      "bg_1",
    );
    expect(b).toMatchObject({
      propertyId: "p1",
      unitId: "u1",
      category: "Council Rates",
      taxCategory: "Immediate Deduction",
      providerId: "prov_1",
      issueDate: "2026-08-01",
      notes: "rates",
      source: "Upload",
      billGroupId: "bg_1",
      label: "Instalment 2",
      dueDate: "2026-11-30",
      amount: 557.9,
      status: "Unpaid",
    });
  });

  it("never copies payment state or one-off ids", () => {
    const [b] = instalmentBills(
      sharedBillFields(saved),
      [newInstalmentRow(2, { dueDate: "2026-11-30", amount: "1" })],
      "bg_1",
    );
    for (const k of ["id", "created_at", "paidDate", "paidAmount", "emailMessageId"])
      expect(b).not.toHaveProperty(k);
  });
});

describe("validateInstalments", () => {
  it("requires a date and a positive amount on every row (the saved-bill editor had no check)", () => {
    expect(
      validateInstalments([newInstalmentRow(2, { dueDate: "2026-11-30", amount: "10" })]),
    ).toBeNull();
    expect(validateInstalments([newInstalmentRow(2, { amount: "10" })])).toMatch(
      /due date and amount/,
    );
    expect(
      validateInstalments([newInstalmentRow(2, { dueDate: "2026-11-30", amount: "0" })]),
    ).toMatch(/due date and amount/);
  });
});

describe("instalmentLabel", () => {
  it("is 1-based everywhere", () => {
    expect(instalmentLabel(1)).toBe("Instalment 1");
    expect(newInstalmentRow(4).label).toBe("Instalment 4");
  });
});
