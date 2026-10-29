import { describe, expect, it } from "vitest";
import {
  instalmentBills,
  instalmentGroupSummary,
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

describe("instalmentGroupSummary", () => {
  // The Facer Ct land tax schedule: 1–7 paid, 8 part-paid, 9 unpaid.
  const inst = (n: number, dueDate: string, status: PropertyBill["status"], paidAmount?: number) =>
    ({ id: `b${n}`, billType: "Land Tax", label: `Instalment ${n}`, dueDate, amount: 678, status, paidAmount }) as PropertyBill;
  const schedule = [
    inst(2, "2026-04-20", "Paid", 677.75),
    inst(1, "2026-04-20", "Paid", 678),
    inst(3, "2026-06-19", "Paid", 677.75),
    inst(4, "2026-07-20", "Paid", 677.75),
    inst(5, "2026-08-19", "Paid", 677.75),
    inst(6, "2026-09-18", "Paid", 677.75),
    inst(7, "2026-10-19", "Paid", 677.75),
    inst(8, "2026-11-18", "Partial", 383.5),
    inst(9, "2026-12-18", "Unpaid"),
  ];

  it("names the first unpaid instalment and what's due on it, not the schedule's first", () => {
    const s = instalmentGroupSummary(schedule);
    expect(s.next?.label).toBe("Instalment 8");
    expect(s.next?.dueDate).toBe("2026-11-18");
    expect(s.nextOwed).toBe(294.5);
    expect(s.pending).toBe(972.5);
    expect(s.total).toBe(6102);
    expect(s.paidCount).toBe(7);
  });

  it("has no next instalment once everything is paid", () => {
    const s = instalmentGroupSummary(schedule.slice(0, 7));
    expect(s.next).toBeUndefined();
    expect(s.nextOwed).toBe(0);
  });
});
