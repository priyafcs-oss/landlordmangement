import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface PropertyMatchRow {
  id: string;
  address: string;
  tenantCode: string | null;
  councilRateRef: string | null;
  waterAccountRef: string | null;
}

/** Common Australian street-type/unit words collapsed to one canonical short form so "St" and
 * "Street", or "Unit 3" and "U3", compare equal — an OCR'd settlement letter or a landlord's own
 * typed-in address rarely spell these the same way, and a raw substring match previously left a
 * document unmatched (and invisible on the intended property's Purchase tab) over exactly this
 * kind of formatting difference rather than an actually different address. */
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

/**
 * Matches an inbound bill to a property. Tries, in order of confidence:
 * 1. Exact match on the bill's account/BPAY reference against councilRateRef or waterAccountRef
 *    — a customer/account reference is far more reliable than fuzzy address text.
 * 2. Exact tenantCode match (server-side port of the client-side matcher in
 *    src/routes/maintenance.tsx's resolvePropertyId).
 * 3. Substring match against the free-text address, normalized so common street-type/unit
 *    abbreviations and punctuation differences don't cause an otherwise-correct match to miss.
 */
export async function matchProperty(
  supabase: SupabaseClient,
  addressText: string,
  accountRef?: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("properties")
    .select("id, address, tenantCode, councilRateRef, waterAccountRef");
  if (error || !data) return null;

  const rows = data as PropertyMatchRow[];

  const ref = accountRef?.trim().toLowerCase();
  if (ref) {
    const byAccount = rows.find(
      (p) =>
        (p.councilRateRef && p.councilRateRef.trim().toLowerCase() === ref) ||
        (p.waterAccountRef && p.waterAccountRef.trim().toLowerCase() === ref),
    );
    if (byAccount) return byAccount.id;
  }

  const q = addressText.trim().toLowerCase();
  if (!q) return null;

  const byCode = rows.find((p) => p.tenantCode?.toLowerCase() === q);
  if (byCode) return byCode.id;

  const normalizedQ = normalizeAddress(q);
  const byAddress = rows.find((p) => {
    const addr = normalizeAddress(p.address);
    return addr.length > 0 && (addr.includes(normalizedQ) || normalizedQ.includes(addr));
  });
  return byAddress?.id ?? null;
}
