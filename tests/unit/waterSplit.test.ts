import { describe, expect, it } from "vitest";
import {
  canRechargeLine,
  classifyWaterCharge,
  lastFixedWaterCharge,
  needsWaterSplit,
  splitWaterTotal,
} from "@/lib/waterSplit";

describe("classifyWaterCharge", () => {
  it("tells usage from fixed charges", () => {
    expect(classifyWaterCharge("Water usage charge")).toBe("usage");
    expect(classifyWaterCharge("Water consumption 42 kL")).toBe("usage");
    expect(classifyWaterCharge("Wastewater usage charge")).toBe("usage");
    expect(classifyWaterCharge("Water service charge")).toBe("fixed");
    expect(classifyWaterCharge("Wastewater service charge")).toBe("fixed");
    expect(classifyWaterCharge("Stormwater charge")).toBe("fixed");
  });

  it("can't tell from a bare total line", () => {
    expect(classifyWaterCharge("Water Bill")).toBe("unknown");
    expect(classifyWaterCharge("Sydney Water")).toBe("unknown");
  });
});

describe("canRechargeLine", () => {
  it("only offers recharge on a water bill's usage line", () => {
    expect(canRechargeLine("Water", "Water", "Water usage charges")).toBe(true);
    expect(canRechargeLine("Water", "Water", "Fixed service charges")).toBe(false);
    expect(canRechargeLine("Water", "Water", "Water Bill")).toBe(false);
  });

  it("keeps recharge on every line of a non-water bill", () => {
    expect(canRechargeLine("Other", "Other", "Broken window repair")).toBe(true);
  });
});

describe("needsWaterSplit", () => {
  // The Facer Ct case: a Sydney Water "your eBill is here" email with only the $441.59 total.
  it("flags an un-itemised water bill", () => {
    expect(needsWaterSplit("Water", [{ description: "Water Bill", amount: "441.59" }])).toBe(true);
  });

  it("doesn't flag an itemised one or a non-water bill", () => {
    expect(
      needsWaterSplit("Water", [
        { description: "Water service charge", amount: "180" },
        { description: "Water usage charge", amount: "261.59" },
      ]),
    ).toBe(false);
    expect(needsWaterSplit("Council", [{ description: "Rates", amount: 500 }])).toBe(false);
  });
});

describe("splitWaterTotal", () => {
  it("splits the total into fixed + usage", () => {
    expect(splitWaterTotal(441.59, 261.59)).toEqual([
      { description: "Fixed service charges", amount: 180, kind: "fixed" },
      { description: "Water usage charges", amount: 261.59, kind: "usage" },
    ]);
  });

  it("returns only a usage line when it's the whole bill", () => {
    expect(splitWaterTotal(100, 100)).toEqual([
      { description: "Water usage charges", amount: 100, kind: "usage" },
    ]);
  });

  it("rejects usage that's zero or more than the total", () => {
    expect(splitWaterTotal(441.59, 0)).toBeNull();
    expect(splitWaterTotal(441.59, NaN)).toBeNull();
    expect(splitWaterTotal(441.59, 500)).toBeNull();
  });
});

describe("lastFixedWaterCharge", () => {
  const bill = (
    dueDate: string,
    lineItems: { description: string; amount: number }[],
    propertyId = "p1",
  ) => ({
    propertyId,
    billType: "Water" as const,
    dueDate,
    lineItems,
  });

  it("uses the latest itemised bill for the property", () => {
    const bills = [
      bill("2026-05-01", [
        { description: "Water service charge", amount: 170 },
        { description: "Water usage charge", amount: 90 },
      ]),
      bill("2026-08-01", [
        { description: "Water service charge", amount: 100 },
        { description: "Wastewater service charge", amount: 80 },
        { description: "Water usage charge", amount: 140 },
      ]),
      bill("2026-09-01", [{ description: "Water Bill", amount: 400 }]),
      bill(
        "2026-09-01",
        [
          { description: "Water service charge", amount: 999 },
          { description: "Water usage charge", amount: 1 },
        ],
        "p2",
      ),
    ];
    expect(lastFixedWaterCharge(bills, "p1")).toBe(180);
  });

  it("is null without an itemised history", () => {
    expect(
      lastFixedWaterCharge(
        [bill("2026-09-01", [{ description: "Sydney Water", amount: 400 }])],
        "p1",
      ),
    ).toBeNull();
  });
});
