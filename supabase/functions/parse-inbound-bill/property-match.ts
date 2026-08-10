import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface PropertyMatchRow {
  id: string;
  address: string;
  tenantCode: string | null;
  councilRateRef: string | null;
  waterAccountRef: string | null;
}

/**
 * Matches an inbound bill to a property. Tries, in order of confidence:
 * 1. Exact match on the bill's account/BPAY reference against councilRateRef or waterAccountRef
 *    — a customer/account reference is far more reliable than fuzzy address text.
 * 2. Exact tenantCode match (server-side port of the client-side matcher in
 *    src/routes/maintenance.tsx's resolvePropertyId).
 * 3. Substring match against the free-text address.
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

  const byAddress = rows.find((p) => {
    const addr = p.address.toLowerCase();
    return addr.length > 0 && (addr.includes(q) || q.includes(addr));
  });
  return byAddress?.id ?? null;
}
