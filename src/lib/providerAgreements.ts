import type { ProviderAgreement } from "./types";

/** The most recent ProviderAgreement for one (providerId, propertyId) pair — there's no
 * uniqueness constraint on that pair (a renewed agreement is a new row, so the prior one's terms
 * stay on file rather than being overwritten), so every caller that needs "the current one" picks
 * by latest `contractStartDate`, falling back to `created_at` when start date wasn't captured. */
export function latestAgreementFor(
  agreements: ProviderAgreement[],
  providerId: string,
  propertyId: string,
): ProviderAgreement | undefined {
  const matches = agreements.filter((a) => a.providerId === providerId && a.propertyId === propertyId);
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => (b.contractStartDate ?? b.created_at ?? "").localeCompare(a.contractStartDate ?? a.created_at ?? ""))[0];
}

/** Every agreement a provider holds across the whole portfolio, most recent first. */
export function agreementsForProvider(agreements: ProviderAgreement[], providerId: string): ProviderAgreement[] {
  return [...agreements]
    .filter((a) => a.providerId === providerId)
    .sort((a, b) => (b.contractStartDate ?? b.created_at ?? "").localeCompare(a.contractStartDate ?? a.created_at ?? ""));
}
