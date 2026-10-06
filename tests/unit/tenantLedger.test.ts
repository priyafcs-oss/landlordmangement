import { describe, expect, it } from "vitest";
import { buildTenantLedger, paidUpToDetails } from "@/lib/calculations";
import type { LedgerEntry, Tenant } from "@/lib/types";

const tenant = {
  id: "t1",
  leaseStart: "2026-03-14",
  paidUpToDate: "2026-03-13",
  rentAmount: 1170,
  rentFrequency: "Weekly",
} as unknown as Tenant;

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return { id: crypto.randomUUID(), tenantId: "t1", date: "2026-03-13", type: "Rent Payment", description: "", debit: 0, credit: 0, ...overrides } as LedgerEntry;
}

// 14 fortnightly payments of $2,340 from a 14 Mar 2026 lease start cover exactly to 25 Sep 2026.
const rent = Array.from({ length: 14 }, (_, i) => entry({ date: `2026-${String(3 + Math.floor(i / 2)).padStart(2, "0")}-15`, credit: 2340 }));
const water = [entry({ type: "Water Invoice", date: "2026-05-20", credit: 60.23 }), entry({ type: "Water Invoice", date: "2026-08-15", credit: 205.28 })];

describe("water recharges on the tenant ledger", () => {
  it("don't move the paid-up-to date", () => {
    expect(paidUpToDetails(tenant, [...rent, ...water])).toEqual({ date: "2026-09-25", extra: 0 });
  });

  it("net to zero on the running balance, so the tenant doesn't look in credit by the water paid", () => {
    const withWater = buildTenantLedger(tenant, [...rent, ...water], []);
    const rentOnly = buildTenantLedger(tenant, rent, []);
    expect(withWater.total).toBeCloseTo(rentOnly.total, 2);
    const waterRow = withWater.rows.find((r) => r.description.startsWith("Water Invoice"))!;
    expect(waterRow.debit).toBe(waterRow.credit);
  });
});
