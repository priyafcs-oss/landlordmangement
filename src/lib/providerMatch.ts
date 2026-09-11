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
/**
 * Same tiered logic as matchProviderByName below, exposed for a single pairwise comparison (e.g.
 * an invoice's extracted vendor against one existing transaction's own description) rather than a
 * whole-directory lookup — used wherever two free-text business names need to be recognized as
 * the same real-world vendor despite a legal-suffix difference, reordering, or extra
 * surrounding text (an itemName like "ABC Pty Ltd (Inv: 123) Repairs" still contains "ABC" as a
 * whole token). Doesn't correct actual spelling/OCR errors in either string — that needs fuzzy
 * edit-distance matching, deliberately not attempted here to avoid false-positive matches between
 * genuinely different vendors.
 * 1. Case-insensitive EXACT match.
 * 2. Word-boundary token match — every significant token of the SHORTER name appears as a WHOLE
 *    token in the longer name.
 */
export function namesLooselyMatch(a: string, b: string): boolean {
  const trimmedA = a.trim();
  const trimmedB = b.trim();
  if (!trimmedA || !trimmedB) return false;
  if (trimmedA.toLowerCase() === trimmedB.toLowerCase()) return true;

  const tokensA = significantTokens(trimmedA);
  const tokensB = significantTokens(trimmedB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const longerSet = new Set(longer);
  return shorter.every((t) => longerSet.has(t));
}

export function matchProviderByName<T extends { name: string }>(providers: T[], name: string): T | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return providers.find((p) => namesLooselyMatch(p.name, trimmed));
}
