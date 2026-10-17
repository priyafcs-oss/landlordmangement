import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fmtCompactCurrency,
  fmtCurrencyWhole,
  formatMonthLabel,
  formatTime12h,
  propertyLabel,
} from "@/lib/format";
import { addDays, isDueWithin, round2 } from "@/lib/calculations";
import { buildRechargeInvoice } from "@/lib/recharge";

describe("shared formatters", () => {
  // Three of the four old copies printed "Invalid Date" for a row with no date.
  it("month label, with a guard for rows with no date", () => {
    expect(formatMonthLabel("2026-10")).toBe("October 2026");
    expect(formatMonthLabel("")).toBe("No date");
    expect(formatMonthLabel("unknown")).toBe("No date");
  });

  it("12-hour time", () => {
    expect(formatTime12h("14:30")).toBe("2:30 PM");
    expect(formatTime12h("00:05")).toBe("12:05 AM");
    expect(formatTime12h("soon")).toBe("soon");
  });

  it("compact currency for tiles and chart axes", () => {
    expect(fmtCompactCurrency(1_250_000)).toBe("$1.25M");
    expect(fmtCompactCurrency(1_250_000, { axis: true })).toBe("$1.3M");
    expect(fmtCompactCurrency(-45_600)).toBe("-$46k");
    expect(fmtCompactCurrency(441.59)).toBe("$441.59");
    expect(fmtCompactCurrency(441.59, { axis: true })).toBe("$442");
    expect(fmtCurrencyWhole(1234.56)).toBe("$1,235");
  });

  it("rounds to cents", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(261.5861)).toBe(261.59);
  });
});

describe("date helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T09:00:00+11:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("isDueWithin counts today up to N days ahead, not the past", () => {
    expect(isDueWithin("2026-10-17", 60)).toBe(true);
    expect(isDueWithin("2026-12-16", 60)).toBe(true);
    expect(isDueWithin("2026-12-17", 60)).toBe(false);
    expect(isDueWithin("2026-10-16", 60)).toBe(false);
    expect(isDueWithin(undefined, 60)).toBe(false);
  });

  // The recharge due date was computed with raw milliseconds instead of addDays.
  it("recharge invoices fall due 14 days after the charge, across daylight saving", () => {
    expect(
      buildRechargeInvoice({
        tenantId: "t",
        chargeType: "Other",
        amount: 1,
        date: "2026-09-25",
        description: "x",
      }).dueDate,
    ).toBe(addDays("2026-09-25", 14));
    expect(addDays("2026-09-25", 14)).toBe("2026-10-09");
  });
});

describe("propertyLabel", () => {
  it("is the nickname, else the address, else undefined", () => {
    expect(propertyLabel({ alias: "Facer Ct", address: "10 Facer Ct Castle Hill" })).toBe("Facer Ct");
    expect(propertyLabel({ address: "10 Facer Ct Castle Hill" })).toBe("10 Facer Ct Castle Hill");
    expect(propertyLabel(undefined)).toBeUndefined();
  });
});
