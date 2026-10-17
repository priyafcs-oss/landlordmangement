/**
 * The ONE provider-matching rule, shared by the edge functions (parse-inbound-bill/provider-match.ts)
 * and the app (src/lib/providerMatch.ts). Dependency-free so both runtimes can import it. The app
 * used to carry its own copy that skipped the ABN tier and took the first loose match even when a
 * later provider matched the name exactly; the Providers tab had a third, exact-name-only rule.
 */

const STOPWORD_TOKENS = new Set(["and", "the", "pty", "ltd"]);

/** Lowercases, strips everything but letters/digits, and collapses whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeAbn(abn: string | null | undefined): string {
  return (abn ?? "").replace(/[^0-9]/g, "");
}

/** Significant tokens of a name — drops ≤2-char tokens and legal-suffix filler ("pty", "ltd"). */
function significantTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORD_TOKENS.has(t));
}

/**
 * Whether two free-text business names are the same vendor: case-insensitive equal, or every
 * significant token of the shorter name appears as a WHOLE token in the longer one ("Sydney Water"
 * ~ "Sydney Water Corporation"; "ABC Pty Ltd (Inv 123) Repairs" contains "ABC"). Not a substring
 * test — "Aircon" must not match "BGS Airconditioning". No spelling/OCR fuzziness, on purpose.
 */
export function namesLooselyMatch(a: string, b: string): boolean {
  const ta = a.trim();
  const tb = b.trim();
  if (!ta || !tb) return false;
  if (ta.toLowerCase() === tb.toLowerCase()) return true;
  const tokensA = significantTokens(ta);
  const tokensB = significantTokens(tb);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const longerSet = new Set(longer);
  return shorter.every((t) => longerSet.has(t));
}

/**
 * The provider a vendor name (and ABN, when known) refers to. Tiers, most reliable first:
 * 1. Same ABN — far more reliable than a name, which varies in formatting and suffixes.
 * 2. Case-insensitive exact name.
 * 3. Word-token match (namesLooselyMatch).
 * A provider whose ABN differs from the given one is never matched by name: same name, different
 * ABN is a different business.
 */
export function findProvider<T extends { name: string; abn?: string | null }>(
  rows: T[],
  name: string | null | undefined,
  abn?: string | null,
): T | undefined {
  const trimmed = (name ?? "").trim();
  const cleanAbn = normalizeAbn(abn);
  if (cleanAbn) {
    const byAbn = rows.find((p) => normalizeAbn(p.abn) === cleanAbn);
    if (byAbn) return byAbn;
  }
  if (!trimmed) return undefined;
  const candidates = cleanAbn
    ? rows.filter((p) => !normalizeAbn(p.abn) || normalizeAbn(p.abn) === cleanAbn)
    : rows;
  const lower = trimmed.toLowerCase();
  return (
    candidates.find((p) => p.name.trim().toLowerCase() === lower) ??
    candidates.find((p) => namesLooselyMatch(p.name, trimmed))
  );
}

/** Whether a bill/expense row belongs to a provider: linked by id, or (for rows that only ever got
 * a plain-text provider name) the name matches. Used by the provider pages' history and summaries. */
export function rowBelongsToProvider(
  row: { providerId?: string | null; providerName?: string | null },
  provider: { id: string; name: string },
): boolean {
  return (
    row.providerId === provider.id ||
    (!!row.providerName && namesLooselyMatch(provider.name, row.providerName))
  );
}
