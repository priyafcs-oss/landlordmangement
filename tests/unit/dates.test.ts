import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  buildTenantLedger,
  healPaidUpDates,
  leaseEndDate,
  localISO,
  todayISO,
} from "@/lib/calculations";
import { computeUpcomingRepayments } from "@/lib/overview";
import type { LedgerEntry, Loan, Tenant } from "@/lib/types";

// vitest.config.ts runs every test on Australia/Sydney time. NSW daylight saving starts on
// 4 Oct 2026 and ends on 4 Apr 2027 — date-only maths that mixed a UTC parse with a local-time
// setDate/setMonth lost a day on every date after the clock change.

describe("test environment", () => {
  it("runs on Sydney time, so the DST cases below actually exercise a clock change", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Australia/Sydney");
  });
});

describe("addDays / addMonths across daylight saving", () => {
  it("addDays doesn't lose a day after DST starts (was 2026-10-08)", () => {
    expect(addDays("2026-10-03", 6)).toBe("2026-10-09");
    expect(addDays("2026-10-03", 7)).toBe("2026-10-10");
    expect(addDays("2026-10-10", -7)).toBe("2026-10-03");
  });

  it("addDays doesn't gain a day after DST ends", () => {
    expect(addDays("2027-04-01", 7)).toBe("2027-04-08");
    expect(addDays("2027-04-08", -7)).toBe("2027-04-01");
  });

  it("addMonths doesn't shift a day across DST start or end", () => {
    expect(addMonths("2026-09-15", 1)).toBe("2026-10-15");
    expect(addMonths("2027-03-15", 1)).toBe("2027-04-15");
    expect(addMonths("2026-10-15", -3)).toBe("2026-07-15");
  });

  it("accepts a full timestamp, using its date part", () => {
    expect(addDays("2026-10-03T14:30:00Z", 1)).toBe("2026-10-04");
  });
});

describe("today's date", () => {
  afterEach(() => vi.useRealTimers());

  it("todayISO is the local date, not the UTC one (Sydney is a day ahead before ~11am)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T22:00:00Z")); // 9am 16 Oct in Sydney (AEDT)
    expect(todayISO()).toBe("2026-10-16");
  });

  it("localISO reads a locally-built date back as that same calendar date", () => {
    // new Date(y, m, 0) is local midnight on the month's last day — toISOString() said the 30th.
    expect(localISO(new Date(2026, 10, 0))).toBe("2026-10-31");
    expect(localISO(new Date(2026, 9, 4))).toBe("2026-10-04");
  });
});

describe("tenant ledger Rent Due cycles", () => {
  const tenant = (overrides: Partial<Tenant>) =>
    ({
      id: "t1",
      paidUpToDate: "2026-09-18",
      rentAmount: 1170,
      rentFrequency: "Weekly",
      ...overrides,
    }) as unknown as Tenant;
  const dueRows = (t: Tenant) =>
    buildTenantLedger(t, [], [])
      .rows.filter((r) => r.isDue)
      .map((r) => r.description);

  it("weekly cycles stay 7 days long across DST start (Facer Ct: was 10-03 → 10-08)", () => {
    expect(dueRows(tenant({ leaseStart: "2026-09-26" })).slice(0, 3)).toEqual([
      "Rent Due: 2026-09-26 → 2026-10-02",
      "Rent Due: 2026-10-03 → 2026-10-09",
      "Rent Due: 2026-10-10 → 2026-10-16",
    ]);
  });

  it("fortnightly cycles stay 14 days long across DST start", () => {
    expect(
      dueRows(tenant({ leaseStart: "2026-09-19", rentFrequency: "Fortnightly" })).slice(0, 2),
    ).toEqual(["Rent Due: 2026-09-19 → 2026-10-02", "Rent Due: 2026-10-03 → 2026-10-16"]);
  });
});

describe("leaseEndDate", () => {
  it("ends the day before the same date 6/12 months on, across DST", () => {
    expect(leaseEndDate("2026-09-15", "6 Months")).toBe("2027-03-14");
    expect(leaseEndDate("2026-10-03", "12 Months")).toBe("2027-10-02");
    expect(leaseEndDate("2026-04-05", "6 Months")).toBe("2026-10-04");
  });

  it("is blank for a periodic lease or no start", () => {
    expect(leaseEndDate("2026-10-03", "Periodic")).toBe("");
    expect(leaseEndDate("", "12 Months")).toBe("");
  });
});

describe("upcoming loan repayments", () => {
  afterEach(() => vi.useRealTimers());

  it("a weekly repayment keeps its weekday across DST start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 12)); // midday 28 Sep, local
    const loan = {
      id: "l1",
      bankName: "Bank",
      accountNumber: "1",
      nextRepaymentDate: "2026-10-01",
      repaymentFrequency: "Weekly",
      monthlyEmi: 1000,
      status: "Active",
    } as unknown as Loan;
    const dates = computeUpcomingRepayments([loan], [], 21).items.map((i) => i.dueDate);
    expect(dates).toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
  });
});

describe("healPaidUpDates", () => {
  const tenant = {
    id: "t1",
    leaseStart: "2026-09-26",
    rentAmount: 1170,
    rentFrequency: "Weekly",
  } as unknown as Tenant;
  const paid = [
    { id: "e1", tenantId: "t1", date: "2026-09-26", type: "Rent Payment", debit: 0, credit: 2340 },
  ] as LedgerEntry[];

  it("corrects a paid-up date stored a day short by the old addDays", () => {
    const healed = healPaidUpDates([{ ...tenant, paidUpToDate: "2026-10-08" }], paid, []);
    expect(healed.map((t) => t.paidUpToDate)).toEqual(["2026-10-09"]);
  });

  it("leaves a correct date alone", () => {
    expect(healPaidUpDates([{ ...tenant, paidUpToDate: "2026-10-09" }], paid, [])).toEqual([]);
  });

  it("never touches anything when the ledger came back empty (a failed load)", () => {
    expect(healPaidUpDates([{ ...tenant, paidUpToDate: "2026-10-08" }], [], [])).toEqual([]);
  });

  it("doesn't 'heal' a big difference — that isn't the DST bug", () => {
    expect(healPaidUpDates([{ ...tenant, paidUpToDate: "2026-12-01" }], paid, [])).toEqual([]);
  });
});
