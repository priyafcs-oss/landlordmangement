import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { findProvider } from "../_shared/providerMatch.ts";

interface ProviderMatchRow {
  id: string;
  name: string;
  abn: string | null;
}

/** The Provider directory record a bill/transaction vendor refers to — the shared matching rule
 * (ABN, then exact name, then word tokens; see _shared/providerMatch.ts) against this landlord's
 * providers. */
export async function matchProvider(
  supabase: SupabaseClient,
  vendorName: string | null | undefined,
  abn?: string | null,
): Promise<string | undefined> {
  const { data, error } = await supabase.from("providers").select("id, name, abn");
  if (error || !data) return undefined;
  return matchProviderInRows(data as ProviderMatchRow[], vendorName, abn);
}

/** Same, against an already-fetched row list — lets a caller matching many lines (one bank
 * statement's transactions) fetch "providers" once instead of once per line. */
export function matchProviderInRows(
  rows: ProviderMatchRow[],
  vendorName: string | null | undefined,
  abn?: string | null,
): string | undefined {
  return findProvider(rows, vendorName, abn)?.id;
}
