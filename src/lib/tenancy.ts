import { todayISO } from "@/lib/calculations";
import type { LedgerEntry, RentFrequency, Tenant } from "@/lib/types";

/**
 * The tenant currently occupying each dwelling — at most one per distinct `unitId` (a
 * single-dwelling property, where every tenant row has unitId unset, counts as one dwelling
 * overall), picking whichever has the most recent leaseStart when more than one "still open" (no
 * leaseExpiry, or a future one) row shares a unit. A tenancy's leaseExpiry is easy to forget to
 * backfill when the next tenant moves in, which otherwise leaves every past tenant reading as
 * still "active" — summing rent across all of them (rather than taking just the current one)
 * multiplies the true rent by however many past tenants that unit has ever had.
 *
 * Pass `propertyId` to scope to one property; without it, `tenants` is assumed to already be one
 * property's (dwellings are only distinct within a property).
 */
export function currentTenants(
  tenants: Tenant[],
  propertyId?: string,
  today = todayISO(),
): Tenant[] {
  const scoped = propertyId ? tenants.filter((t) => t.propertyId === propertyId) : tenants;
  const byUnit = new Map<string, Tenant>();
  for (const t of scoped) {
    if (t.leaseExpiry && t.leaseExpiry < today) continue;
    const key = t.unitId ?? "__shared__";
    const existing = byUnit.get(key);
    if (!existing || (t.leaseStart ?? "") > (existing.leaseStart ?? "")) byUnit.set(key, t);
  }
  return [...byUnit.values()];
}

/** Current tenants across every property — currentTenants per property, so one property's
 * dwellings don't collapse into another's. */
export function currentTenantsAll(tenants: Tenant[], today = todayISO()): Tenant[] {
  const propertyIds = [...new Set(tenants.map((t) => t.propertyId))];
  return propertyIds.flatMap((id) => currentTenants(tenants, id, today));
}

/** The one current tenant of a property (the first dwelling's, for a multi-dwelling property). */
export function currentTenant(
  tenants: Tenant[],
  propertyId: string,
  today = todayISO(),
): Tenant | undefined {
  return currentTenants(tenants, propertyId, today)[0];
}

const PERIODS_PER_YEAR: Record<RentFrequency | "Yearly", number> = {
  Weekly: 52,
  Fortnightly: 26,
  Monthly: 12,
  Yearly: 1,
};

/** Converts a rent amount between periods via its annual figure — exact (weekly → monthly is
 * ×52/12, not the ×4.33 approximation, which undercounts every month). */
export function rentPerPeriod(
  amount: number,
  from: RentFrequency,
  to: RentFrequency | "Yearly",
): number {
  return (amount * PERIODS_PER_YEAR[from]) / PERIODS_PER_YEAR[to];
}

/** A tenant's rent as an annual figure. */
export function annualRentOf(t: Pick<Tenant, "rentAmount" | "rentFrequency">): number {
  return rentPerPeriod(t.rentAmount, t.rentFrequency, "Yearly");
}

/** Rent payments received from these tenants (all of a property's tenants, past and present) in
 * [start, end] — the one definition of "rent collected" behind the P&L, tax summary, portfolio
 * roll-up, property summary and fee check. Omit the dates for all time. */
export function rentPayments(
  ledger: LedgerEntry[],
  tenants: Pick<Tenant, "id">[],
  start = "0000-01-01",
  end = "9999-12-31",
): LedgerEntry[] {
  const ids = new Set(tenants.map((t) => t.id));
  return ledger.filter((e) => ids.has(e.tenantId) && e.type === "Rent Payment" && e.date >= start && e.date <= end);
}

/** Total of rentPayments. */
export function rentCollected(ledger: LedgerEntry[], tenants: Pick<Tenant, "id">[], start?: string, end?: string): number {
  return rentPayments(ledger, tenants, start, end).reduce((s, e) => s + e.credit, 0);
}
