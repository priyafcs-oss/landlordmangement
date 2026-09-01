import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface ProviderMatchRow {
  id: string;
  name: string;
  abn: string | null;
}

/** Lowercases, strips everything but letters/digits, and collapses whitespace — so "ABC Plumbing
 * Pty Ltd" and "abc plumbing" compare equal despite punctuation/suffix noise. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeAbn(abn: string): string {
  return abn.replace(/[^0-9]/g, "");
}

/**
 * Matches a bill/transaction vendor to an existing Provider directory record. Tiers, in order of
 * confidence (mirrors property-match.ts's tiered, hand-rolled style — no fuzzy-matching library
 * exists in this codebase):
 * 1. Exact ABN match, when both sides have one — an ABN is a far more reliable identifier than a
 *    vendor name, which varies in formatting/capitalisation/legal-suffix across documents.
 * 2. Case-insensitive EXACT name match (no wildcards) — "Origin Energy" must equal "origin energy"
 *    exactly, not merely contain it, to avoid false positives between unrelated similarly-named
 *    vendors.
 * 3. Normalized-token substring match — punctuation/whitespace stripped from both sides, then one
 *    contains the other (handles a legal-suffix difference like "Jones Plumbing" vs. "Jones
 *    Plumbing Pty Ltd").
 */
export async function matchProvider(
  supabase: SupabaseClient,
  vendorName: string | null | undefined,
  abn?: string | null,
): Promise<string | undefined> {
  const { data, error } = await supabase.from("providers").select("id, name, abn");
  if (error || !data) return undefined;
  return matchProviderInRows(data as ProviderMatchRow[], vendorName, abn);
}

/**
 * Same tiered logic as matchProvider, but against an already-fetched row list — lets a caller
 * matching many lines against the same document (e.g. one bank statement's transactions) fetch
 * "providers" once instead of once per line.
 */
export function matchProviderInRows(
  rows: ProviderMatchRow[],
  vendorName: string | null | undefined,
  abn?: string | null,
): string | undefined {
  const name = (vendorName ?? "").trim();
  const cleanAbn = abn ? normalizeAbn(abn) : "";
  if (!name && !cleanAbn) return undefined;

  if (cleanAbn) {
    const byAbn = rows.find((p) => p.abn && normalizeAbn(p.abn) === cleanAbn);
    if (byAbn) return byAbn.id;
  }

  if (!name) return undefined;
  const lowerName = name.toLowerCase();
  const byExactName = rows.find((p) => p.name.trim().toLowerCase() === lowerName);
  if (byExactName) return byExactName.id;

  const normalizedName = normalize(name);
  if (!normalizedName) return undefined;
  const byNormalized = rows.find((p) => {
    const n = normalize(p.name);
    return n.length > 0 && (n.includes(normalizedName) || normalizedName.includes(n));
  });
  return byNormalized?.id;
}
