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

/** Common legal-suffix/filler tokens that carry no identifying weight on their own — dropped
 * (along with anything ≤2 chars) before the Tier 3 word-boundary comparison, same reasoning as
 * property-match.ts stripping "unit"/"lot"/etc. */
const STOPWORD_TOKENS = new Set(["and", "the", "pty", "ltd"]);

/** Lowercases, strips punctuation and splits on whitespace into significant tokens (drops ≤2-char
 * and stopword tokens) — used by Tier 3's word-boundary match below. */
function significantTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORD_TOKENS.has(t));
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
 * 3. Word-boundary token match — punctuation/whitespace stripped from both sides and tokenized,
 *    short/generic tokens dropped, then every significant token of the SHORTER name's token set
 *    must appear as a WHOLE token in the longer name's token set (handles a legal-suffix
 *    difference like "Jones Plumbing" vs. "Jones Plumbing Pty Ltd") — not a raw substring test,
 *    which previously let a short existing provider name (e.g. something containing "aircon")
 *    falsely match an unrelated new vendor like "BGS Airconditioning and Electricals" merely
 *    because one string appeared inside the other.
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

  const candidateTokens = significantTokens(name);
  if (candidateTokens.length === 0) return undefined;
  const byWordBoundary = rows.find((p) => {
    const existingTokens = significantTokens(p.name);
    if (existingTokens.length === 0) return false;
    const [shorter, longer] =
      existingTokens.length <= candidateTokens.length ? [existingTokens, candidateTokens] : [candidateTokens, existingTokens];
    const longerSet = new Set(longer);
    return shorter.every((t) => longerSet.has(t));
  });
  return byWordBoundary?.id;
}
