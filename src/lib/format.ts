import { fmtCurrency } from "@/lib/calculations";

/** "2026-10" → "October 2026" (a month-group heading). "No date" for an empty or malformed key —
 * three of the four copies this replaces printed "Invalid Date" for rows with no date. */
export function formatMonthLabel(key: string): string {
  const [y, m] = (key ?? "").split("-").map(Number);
  if (!y || !m) return "No date";
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

/** "14:30" → "2:30 PM". Falls back to the raw value if it's not a plain HH:MM string. */
export function formatTime12h(time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hour24 = Number(match[1]);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${match[2]} ${period}`;
}

/** Whole dollars, no cents: "$1,234". */
export function fmtCurrencyWhole(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Short dollar figures for tight spaces: "$1.25M", "$123k". Below $1,000 it shows the full amount
 * with cents (a summary tile), or with `axis` whole dollars and one-decimal millions (chart axes).
 */
export function fmtCompactCurrency(n: number, { axis = false }: { axis?: boolean } = {}): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(axis ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return axis ? `${sign}$${Math.round(abs)}` : `${sign}${fmtCurrency(abs)}`;
}

/** A property's display name: its nickname (alias), else its address. Same value as the
 * `p.alias || p.address` it replaces everywhere (undefined when there's no property). */
export function propertyLabel(p: { alias?: string; address: string }): string;
export function propertyLabel(
  p: { alias?: string; address: string } | undefined | null,
): string | undefined;
export function propertyLabel(
  p: { alias?: string; address: string } | undefined | null,
): string | undefined {
  return p ? p.alias || p.address : undefined;
}

/** "1 file", "3 files". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
