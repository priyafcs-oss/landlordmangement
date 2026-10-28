import { describe, expect, it } from "vitest";
import { planRecharge, rechargeChargeType } from "@/lib/recharge";
import {
  blankBillLine,
  billLinesToRows,
  newlyRechargedLines,
  planBillLines,
} from "@/lib/billLines";
import { rechargeEmail } from "@/lib/tenantEmails";
import { canRechargeLine, rechargeBlockedReason } from "@/lib/waterSplit";

const base = {
  chargeType: "Water Usage" as const,
  amount: 261.59,
  date: "2026-10-17",
  description: "Water usage",
};

describe("planRecharge", () => {
  it("invoices once when ticked with a tenant", () => {
    const r = planRecharge({ ...base, wanted: true, tenantId: "t1" });
    expect(r.invoice).toMatchObject({
      tenantId: "t1",
      amountDue: 261.59,
      chargeType: "Water Usage",
    });
    expect(r).toMatchObject({ rechargeToTenant: true, recharged: true });
  });

  // An agent-statement expense saved without `recharged` was invoiced again on the next edit.
  it("never invoices an item that's already been recharged", () => {
    const r = planRecharge({ ...base, wanted: true, tenantId: "t1", alreadyRecharged: true });
    expect(r.invoice).toBeUndefined();
    expect(r.recharged).toBe(true);
  });

  it("keeps recharged set after the box is unticked, and re-ticking doesn't invoice again", () => {
    const unticked = planRecharge({
      ...base,
      wanted: false,
      tenantId: "t1",
      alreadyRecharged: true,
    });
    expect(unticked).toMatchObject({
      rechargeToTenant: false,
      recharged: true,
      invoice: undefined,
    });
    expect(
      planRecharge({ ...base, wanted: true, tenantId: "t1", alreadyRecharged: unticked.recharged })
        .invoice,
    ).toBeUndefined();
  });

  it("does nothing without a tenant or when not wanted", () => {
    expect(planRecharge({ ...base, wanted: true }).invoice).toBeUndefined();
    expect(planRecharge({ ...base, wanted: false, tenantId: "t1" })).toMatchObject({
      rechargeToTenant: false,
      recharged: false,
    });
  });
});

describe("rechargeChargeType", () => {
  it("maps bills and expenses the same way", () => {
    expect(rechargeChargeType("Water")).toBe("Water Usage");
    expect(rechargeChargeType("Water Charges")).toBe("Water Usage");
    expect(rechargeChargeType("Repairs & Maintenance")).toBe("Other");
    expect(rechargeChargeType(undefined)).toBe("Other");
  });
});

describe("water usage-only gate for expenses too", () => {
  it("applies to Water Charges expenses", () => {
    expect(canRechargeLine(undefined, "Water Charges", "Water usage Q1")).toBe(true);
    expect(canRechargeLine(undefined, "Water Charges", "Water service charge")).toBe(false);
    expect(canRechargeLine(undefined, "Repairs & Maintenance", "Broken tap")).toBe(true);
  });

  it("explains why a line can't be recharged", () => {
    expect(rechargeBlockedReason("Water", "Water", "Wastewater service charge")).toMatch(
      /Fixed charge/,
    );
    expect(rechargeBlockedReason("Water", "Water", "Water Bill")).toBeUndefined();
    expect(
      rechargeBlockedReason(undefined, "Water Charges", "Sydney Water", { unknownHint: "hint" }),
    ).toBe("hint");
    expect(rechargeBlockedReason("Water", "Water", "Water usage")).toBeUndefined();
  });
});

describe("planBillLines (both bill dialogs)", () => {
  const rows = [
    blankBillLine("Water", {
      description: "Fixed service charges",
      amount: "180.00",
      rechargeToTenant: true,
      tenantId: "t1",
    }),
    blankBillLine("Water", {
      description: "Water usage charges",
      amount: "261.59",
      rechargeToTenant: true,
      tenantId: "t1",
    }),
    blankBillLine("Water", { description: "", amount: "" }),
  ];

  it("invoices only the usage line, ignores a ticked fixed line, drops empty rows", () => {
    const { lineItems, invoices } = planBillLines(rows, { billType: "Water", date: "2026-10-17" });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amountDue: 261.59, chargeType: "Water Usage" });
    expect(lineItems).toHaveLength(2);
    expect(lineItems[0]).toMatchObject({
      description: "Fixed service charges",
      rechargeToTenant: undefined,
      recharged: undefined,
    });
    expect(lineItems[1]).toMatchObject({ rechargeToTenant: true, tenantId: "t1", recharged: true });
  });

  // BillDetailDialog kept its pre-save rows after Save, so a second Save invoiced again.
  it("re-saving the saved lines invoices nothing", () => {
    const first = planBillLines(rows, { billType: "Water", date: "2026-10-17" });
    const reloaded = billLinesToRows(first.lineItems, "Water");
    expect(newlyRechargedLines("Water", reloaded)).toHaveLength(0);
    expect(
      planBillLines(reloaded, { billType: "Water", date: "2026-10-17" }).invoices,
    ).toHaveLength(0);
  });

  it("lists only lines newly recharged by this save (for Save & Notify)", () => {
    expect(newlyRechargedLines("Water", rows).map((r) => r.description)).toEqual([
      "Water usage charges",
    ]);
  });
});

describe("rechargeEmail", () => {
  it("names the tenant, property, line and amount", () => {
    const m = rechargeEmail({
      tenantName: "Sam",
      propertyLabel: "10 Facer Ct",
      billType: "Water",
      description: "Water usage charges",
      amount: 261.59,
    });
    expect(m.subject).toBe("Water — Water usage charges ($261.59)");
    expect(m.body).toContain("Hi Sam");
    expect(m.body).toContain("10 Facer Ct water bill");
    expect(m.body).toContain("$261.59");
  });
});
