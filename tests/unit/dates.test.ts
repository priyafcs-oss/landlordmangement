import { describe, expect, it } from "vitest";
import { addDays, addMonths, buildTenantLedger } from "@/lib/calculations";
import type { Tenant } from "@/lib/types";

// Run with TZ=Australia/Sydney to reproduce the original bug: NSW daylight saving starts 4 Oct 2026,
// and a local-time setDate on a UTC-parsed date lost a day for every date after it.
describe("date-only arithmetic across a daylight-saving change", () => {
  it("addDays doesn't lose a day after DST starts", () => {
    expect(addDays("2026-10-03", 6)).toBe("2026-10-09");
    expect(addDays("2026-10-03", 7)).toBe("2026-10-10");
    expect(addDays("2026-10-10", -7)).toBe("2026-10-03");
  });

  it("addMonths doesn't shift a day across DST start or end", () => {
    expect(addMonths("2026-09-15", 1)).toBe("2026-10-15");
    expect(addMonths("2027-03-15", 1)).toBe("2027-04-15");
  });

  it("weekly Rent Due cycles stay 7 days long", () => {
    const tenant = {
      id: "t1",
      leaseStart: "2026-09-26",
      paidUpToDate: "2026-09-25",
      rentAmount: 1170,
      rentFrequency: "Weekly",
    } as unknown as Tenant;
    const due = buildTenantLedger(tenant, [], [])
      .rows.filter((r) => r.isDue)
      .map((r) => r.description);
    expect(due.slice(0, 3)).toEqual([
      "Rent Due: 2026-09-26 → 2026-10-02",
      "Rent Due: 2026-10-03 → 2026-10-09",
      "Rent Due: 2026-10-10 → 2026-10-16",
    ]);
  });
});
