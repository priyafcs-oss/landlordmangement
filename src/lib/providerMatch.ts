/** Common legal-suffix/filler tokens that carry no identifying weight on their own — dropped
 * (along with anything ≤2 chars) before the word-boundary comparison. */
const STOPWORD_TOKENS = new Set(["and", "the", "pty", "ltd"]);

/** Lowercases, strips punctuation and collapses whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Splits a normalized name into significant tokens (drops ≤2-char and stopword tokens) — used by
 * the word-boundary tier below. */
function significantTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORD_TOKENS.has(t));
}

/**
 * Matches a vendor/payee name to an existing Provider directory record. Same tiered logic as the
 * server-side matchProviderInRows (supabase/functions/parse-inbound-bill/provider-match.ts) —
 * kept in sync by hand since an edge function and the client build can't share a module here.
 * Without the word-boundary tier, every client-side provider-creation path (findOrCreateProvider,
 * AddBillDialog's own save) only ever did an exact case-insensitive match, unlike the automated
 * email/upload pipeline — so the same real vendor phrased slightly differently across two
 * documents (e.g. "Sydney Water" vs "Sydney Water Corporation") got a second directory entry only
 * when added by hand, not when it came in automatically.
 * 1. Case-insensitive EXACT match.
 * 2. Word-boundary token match — punctuation/whitespace stripped and tokenized, short/generic
 *    tokens dropped, then every significant token of the SHORTER name's token set must appear as a
 *    WHOLE token in the longer name's token set (handles a legal-suffix/trading-name difference
 *    without false-positiving on an unrelated vendor that merely contains a shared substring).
 */
export function matchProviderByName<T extends { name: string }>(providers: T[], name: string): T | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const exact = providers.find((p) => p.name.trim().toLowerCase() === lower);
  if (exact) return exact;

  const candidateTokens = significantTokens(trimmed);
  if (candidateTokens.length === 0) return undefined;
  return providers.find((p) => {
    const existingTokens = significantTokens(p.name);
    if (existingTokens.length === 0) return false;
    const [shorter, longer] =
      existingTokens.length <= candidateTokens.length ? [existingTokens, candidateTokens] : [candidateTokens, existingTokens];
    const longerSet = new Set(longer);
    return shorter.every((t) => longerSet.has(t));
  });
}
