import { describe, expect, it } from "vitest";
import {
  annualRentOf,
  currentTenant,
  currentTenants,
  currentTenantsAll,
  rentPerPeriod,
  rentCollected,
  rentPayments,
} from "@/lib/tenancy";
import type { Tenant } from "@/lib/types";

const t = (id: string, over: Partial<Tenant> = {}): Tenant =>
  ({ id, name: id, propertyId: "p1", rentAmount: 500, rentFrequency: "Weekly", ...over }) as Tenant;
const TODAY = "2026-10-17";

describe("currentTenants", () => {
  it("drops expired leases and keeps the newest open tenancy per dwelling", () => {
    const tenants = [
      t("past", { leaseStart: "2023-01-01", leaseExpiry: "2024-01-01" }),
      // Expiry never backfilled when the next tenant moved in — must not count twice.
      t("stale", { leaseStart: "2024-02-01" }),
      t("now", { leaseStart: "2025-03-01", leaseExpiry: "2027-03-01" }),
    ];
    expect(currentTenants(tenants, "p1", TODAY).map((x) => x.id)).toEqual(["now"]);
  });

  it("keeps one per unit and scopes to the property", () => {
    const tenants = [
      t("a", { unitId: "u1" }),
      t("b", { unitId: "u2" }),
      t("other", { propertyId: "p2" }),
    ];
    expect(
      currentTenants(tenants, "p1", TODAY)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(currentTenant(tenants, "p2", TODAY)?.id).toBe("other");
  });

  // inspections.tsx used tenants.find(propertyId) and could email a long-gone tenant.
  it("never picks a past tenant over the current one", () => {
    const tenants = [
      t("gone", { leaseExpiry: "2025-01-01" }),
      t("current", { leaseStart: "2025-02-01" }),
    ];
    expect(currentTenant(tenants, "p1", TODAY)?.id).toBe("current");
  });

  it("works across properties without merging their dwellings", () => {
    const tenants = [t("a"), t("b", { propertyId: "p2" })];
    expect(
      currentTenantsAll(tenants, TODAY)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });
});

describe("rentPerPeriod", () => {
  it("converts exactly via the annual figure", () => {
    expect(rentPerPeriod(520, "Weekly", "Yearly")).toBe(27040);
    expect(rentPerPeriod(520, "Weekly", "Monthly")).toBeCloseTo(2253.33, 2); // not 520 × 4.33 = 2251.60
    expect(rentPerPeriod(1000, "Fortnightly", "Weekly")).toBe(500);
    expect(rentPerPeriod(2600, "Monthly", "Weekly")).toBe(600);
  });

  it("annualises a tenant's rent", () => {
    expect(annualRentOf({ rentAmount: 2000, rentFrequency: "Monthly" })).toBe(24000);
  });
});

describe("rentCollected (P&L, tax summary, roll-up, summary, fee check)", () => {
  const ledger = [
    { id: "1", tenantId: "a", type: "Rent Payment", date: "2025-07-01", credit: 500, debit: 0 },
    { id: "2", tenantId: "a", type: "Rent Payment", date: "2026-06-30", credit: 500, debit: 0 },
    { id: "3", tenantId: "a", type: "Rent Payment", date: "2026-07-01", credit: 500, debit: 0 },
    { id: "4", tenantId: "a", type: "Water Invoice", date: "2025-09-01", credit: 60, debit: 0 },
    { id: "5", tenantId: "z", type: "Rent Payment", date: "2025-09-01", credit: 999, debit: 0 },
  ] as unknown as Parameters<typeof rentCollected>[0];

  it("sums only rent payments from these tenants within the period, inclusive", () => {
    expect(rentCollected(ledger, [{ id: "a" }], "2025-07-01", "2026-06-30")).toBe(1000);
    expect(rentPayments(ledger, [{ id: "a" }]).map((e) => e.id)).toEqual(["1", "2", "3"]);
  });
});
