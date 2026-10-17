import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeUpcomingRepayments, repaymentAnchor } from "@/lib/overview";
import type { Loan, Property } from "@/lib/types";

const props = [{ id: "p1", address: "10 Facer Ct" }] as Property[];
const loan = (over: Partial<Loan>): Loan =>
  ({
    id: "l1",
    propertyId: "p1",
    bankName: "ANZ",
    totalBalance: 1,
    interestRate: 6,
    monthlyEmi: 4333,
    status: "Active",
    ...over,
  }) as Loan;

describe("loan repayment schedule (Dashboard alerts + Overview card)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T09:00:00+11:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("falls back to the repayment day of month, clamped to the month (not capped at 28)", () => {
    expect(repaymentAnchor({ dueDayOfMonth: 20 }, "2026-10-17")).toBe("2026-10-20");
    expect(repaymentAnchor({ dueDayOfMonth: 31 }, "2026-11-05")).toBe("2026-11-30");
    expect(
      repaymentAnchor({ nextRepaymentDate: "2026-10-25", dueDayOfMonth: 1 }, "2026-10-17"),
    ).toBe("2026-10-25");
    expect(repaymentAnchor({}, "2026-10-17")).toBeUndefined();
  });

  it("schedules a loan that only has a repayment day", () => {
    const { items } = computeUpcomingRepayments([loan({ dueDayOfMonth: 20 })], props, 7);
    expect(items.map((i) => i.dueDate)).toEqual(["2026-10-20"]);
    expect(items[0].amount).toBe(4333);
  });

  // The Dashboard showed the monthly figure for a weekly loan, once.
  it("shows each weekly instalment at its weekly amount", () => {
    const { items } = computeUpcomingRepayments(
      [loan({ nextRepaymentDate: "2026-10-18", repaymentFrequency: "Weekly" })],
      props,
      14,
    );
    expect(items.map((i) => i.dueDate)).toEqual(["2026-10-18", "2026-10-25"]);
    expect(items[0].amount).toBeCloseTo((4333 * 12) / 52, 2);
  });

  it("skips paid-off loans", () => {
    expect(
      computeUpcomingRepayments([loan({ dueDayOfMonth: 20, status: "Paid Off" })], props, 7).items,
    ).toEqual([]);
  });
});
