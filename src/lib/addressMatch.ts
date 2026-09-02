/**
 * Deliberately hand-kept in sync with supabase/functions/parse-inbound-bill/property-match.ts's
 * normalizeAddress/matchProperty — Deno edge functions can't import from src/, same reasoning as
 * providerMatch.ts vs the server's provider-match.ts. Update both sides together.
 */
const ADDRESS_WORD_MAP: Record<string, string> = {
  street: "st",
  road: "rd",
  avenue: "ave",
  drive: "dr",
  court: "ct",
  place: "pl",
  lane: "ln",
  crescent: "cres",
  terrace: "tce",
  highway: "hwy",
  parade: "pde",
  close: "cl",
  grove: "gr",
  boulevard: "blvd",
  unit: "u",
  apartment: "u",
  apt: "u",
  flat: "u",
};

function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,'/#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ADDRESS_WORD_MAP[word] ?? word)
    .join(" ")
    .trim();
}

export interface AddressMatchCandidate {
  id: string;
  address: string;
  tenantCode?: string | null;
}

/** Matches free-text address (or an exact tenant code) against a property list — same
 * normalization the server's matchProperty applies, so a client-side guess (before the AI
 * pipeline's own resolved propertyId is known) finds the same property a human would expect. */
export function matchPropertyByAddress<T extends AddressMatchCandidate>(properties: T[], addressText: string): T | undefined {
  const q = addressText.trim().toLowerCase();
  if (!q) return undefined;

  const byCode = properties.find((p) => p.tenantCode?.toLowerCase() === q);
  if (byCode) return byCode;

  const normalizedQ = normalizeAddress(q);
  return properties.find((p) => {
    const addr = normalizeAddress(p.address);
    return addr.length > 0 && (addr.includes(normalizedQ) || normalizedQ.includes(addr));
  });
}
