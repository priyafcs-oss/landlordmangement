import { RENT_INCOME_CATEGORY } from "@/lib/calculations";
import type { Provider, ProviderProperty, Tenant } from "@/lib/types";

/** Was this tenant living there on `date`? (A lapsed leaseExpiry usually just means periodic, so
 * only an actual vacating date or a lease that hadn't started yet rules them out.) */
function tenantActiveOn(t: Tenant, date: string): boolean {
  if (t.leaseStart && t.leaseStart > date) return false;
  if (t.vacatingDate && t.vacatingDate < date) return false;
  return true;
}

export interface TenantTextMatch {
  tenant: Tenant;
  via: "reference" | "name";
}

/**
 * Which tenant a bank line's text names — their bank reference first (an exact identifier), then
 * account holder or any part of their name longer than 2 letters. Shared by the Rental hub's Bank
 * Feed Import and the bank-account feed's suggestions. Tenants active on `date` win a tie, so a
 * past tenant with a similar name doesn't take a current tenant's deposit.
 */
export function matchTenantByText(
  tenants: Tenant[],
  text: string,
  date?: string,
): TenantTextMatch | undefined {
  const lower = text.toLowerCase();
  const ordered = date
    ? [...tenants].sort((a, b) => Number(tenantActiveOn(b, date)) - Number(tenantActiveOn(a, date)))
    : tenants;
  const byRef = ordered.find((t) => {
    const ref = (t.bankReference ?? "").trim().toLowerCase();
    return ref.length > 0 && lower.includes(ref);
  });
  if (byRef) return { tenant: byRef, via: "reference" };
  const byName = ordered.find((t) => {
    const holder = (t.bankAccountHolder ?? "").trim().toLowerCase();
    if (holder.length > 2 && lower.includes(holder)) return true;
    return t.name
      .toLowerCase()
      .split(/\s+/)
      .some((p) => p.length > 2 && lower.includes(p));
  });
  return byName ? { tenant: byName, via: "name" } : undefined;
}

/** A whole number (≥1) of the tenant's rent periods, within the same ±2%/$2 tolerance the
 * duplicate checks use — what a rent deposit (one week, a fortnight, or a few in arrears) is. */
export function isRentMultiple(amount: number, rentAmount: number): boolean {
  if (!(rentAmount > 0) || !(amount > 0)) return false;
  const periods = Math.round(amount / rentAmount);
  if (periods < 1) return false;
  return Math.abs(amount - periods * rentAmount) <= Math.max(2, amount * 0.02);
}

export interface FeedLine {
  date: string;
  description: string;
  amount: number;
  direction: "in" | "out";
  providerId?: string;
  /** The property the statement itself was filed against, if any. */
  propertyId?: string;
}

export interface FeedSuggestion {
  category: string;
  propertyId: string;
  /** Set when the suggestion is a rent payment for this tenant's ledger. */
  tenantId?: string;
  /** Short human label, e.g. "Rent · Jane Doe". */
  label: string;
  /** Why it was suggested, for a tooltip. */
  reason: string;
}

/**
 * Rule-based suggestion for how to record one bank-feed line, or null when nothing is confident
 * enough to offer one-click. Deliberately conservative — a wrong suggestion accepted in bulk is
 * worse than no suggestion:
 * - A deposit is suggested as rent when its text names a tenant by bank reference, or by name AND
 *   the amount is a whole number of their rent periods; failing any text match, when exactly one
 *   active tenant's rent fits the amount.
 * - A debit is suggested only when its matched provider has a default category and the property
 *   is known (the statement's own, or the provider's only property).
 */
export function suggestFeedLine(
  line: FeedLine,
  ctx: { tenants: Tenant[]; providers: Provider[]; providerProperties: ProviderProperty[] },
): FeedSuggestion | null {
  if (line.direction === "in") {
    const m = matchTenantByText(ctx.tenants, line.description, line.date);
    if (
      m &&
      tenantActiveOn(m.tenant, line.date) &&
      (m.via === "reference" || isRentMultiple(line.amount, m.tenant.rentAmount))
    ) {
      return {
        category: RENT_INCOME_CATEGORY,
        propertyId: m.tenant.propertyId,
        tenantId: m.tenant.id,
        label: `Rent · ${m.tenant.name}`,
        reason:
          m.via === "reference"
            ? "Description contains the tenant's bank reference"
            : "Description names the tenant and the amount matches their rent",
      };
    }
    if (!m) {
      const fits = ctx.tenants.filter(
        (t) => tenantActiveOn(t, line.date) && isRentMultiple(line.amount, t.rentAmount),
      );
      if (fits.length === 1) {
        const t = fits[0];
        return {
          category: RENT_INCOME_CATEGORY,
          propertyId: t.propertyId,
          tenantId: t.id,
          label: `Rent · ${t.name}`,
          reason: "Amount matches this tenant's rent (the only current tenant it fits)",
        };
      }
    }
    return null;
  }

  const provider = line.providerId
    ? ctx.providers.find((p) => p.id === line.providerId)
    : undefined;
  if (!provider?.defaultCategory) return null;
  const providerProps = ctx.providerProperties.filter((pp) => pp.providerId === provider.id);
  const propertyId =
    line.propertyId ?? (providerProps.length === 1 ? providerProps[0].propertyId : undefined);
  if (!propertyId) return null;
  return {
    category: provider.defaultCategory,
    propertyId,
    label: `${provider.defaultCategory} · ${provider.name}`,
    reason: `${provider.name}'s default category`,
  };
}
