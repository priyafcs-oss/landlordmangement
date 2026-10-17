import type { PropertyBill } from "@/lib/types";

export type WaterChargeKind = "usage" | "fixed" | "unknown";

const USAGE_RE = /usage|consumption|volumetric|\bkl\b|kilolit|litres/i;
const FIXED_RE =
  /service|access|availability|fixed|supply|stormwater|sewer|wastewater|daily charge|meter charge/i;

/** Whether a water-bill line is the tenant-rechargeable usage charge, a landlord-only fixed charge
 * (service/access/sewerage/stormwater), or can't be told from its wording (e.g. a single "Water
 * Bill" line from a notification email that only carries the total). Usage wins when a line
 * mentions both ("Wastewater usage charge") — usage is what's metered, whatever the service. */
export function classifyWaterCharge(description: string): WaterChargeKind {
  if (USAGE_RE.test(description)) return "usage";
  if (FIXED_RE.test(description)) return "fixed";
  return "unknown";
}

/** NSW/Vic tenancy law lets a landlord pass on water USAGE but never the fixed service charges,
 * so the recharge option is offered on a water bill's usage lines only. Non-water bills keep it on
 * every line (a tenant-caused repair, say, is rechargeable whatever it's called). */
export function canRechargeLine(
  billType: string | undefined,
  lineCategory: string | undefined,
  description: string,
): boolean {
  return !isWaterLine(billType, lineCategory) || classifyWaterCharge(description) === "usage";
}

/** A water bill line or a "Water Charges" expense. */
function isWaterLine(billType: string | undefined, lineCategory: string | undefined): boolean {
  return billType === "Water" || lineCategory === "Water" || lineCategory === "Water Charges";
}

/** Why a line can't be recharged, for showing in place of the checkbox — undefined when it can, or
 * when there's nothing useful to say (an un-itemised water bill shows the split prompt instead). */
export function rechargeBlockedReason(
  billType: string | undefined,
  lineCategory: string | undefined,
  description: string,
  { unknownHint }: { unknownHint?: string } = {},
): string | undefined {
  if (canRechargeLine(billType ?? "", lineCategory, description)) return undefined;
  return classifyWaterCharge(description) === "fixed"
    ? "Fixed charge — paid by the landlord, can't be recharged"
    : unknownHint;
}

/** A water bill whose lines don't say which part is usage — the review dialog then offers to split
 * it, since otherwise there's no line the usage recharge can go on. */
export function needsWaterSplit(
  billType: string,
  lines: { description: string; amount: string | number }[],
): boolean {
  if (billType !== "Water") return false;
  const priced = lines.filter((l) => (Number(l.amount) || 0) > 0);
  return priced.length > 0 && !priced.some((l) => classifyWaterCharge(l.description) === "usage");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Splits a water bill total into its fixed and usage parts from the usage figure the landlord
 * read off the bill. Returns null when the usage figure isn't a positive amount within the total. */
export function splitWaterTotal(
  total: number,
  usage: number,
): { description: string; amount: number; kind: "fixed" | "usage" }[] | null {
  if (!(usage > 0) || usage > total + 0.005) return null;
  const fixed = round2(total - usage);
  const lines: { description: string; amount: number; kind: "fixed" | "usage" }[] = [];
  if (fixed > 0) lines.push({ description: "Fixed service charges", amount: fixed, kind: "fixed" });
  lines.push({ description: "Water usage charges", amount: round2(usage), kind: "usage" });
  return lines;
}

/** The fixed-charge total from this property's most recent itemised water bill. Fixed service
 * charges barely move quarter to quarter, so this is a good guess at this bill's fixed part when
 * the new bill arrived without a breakdown (usage ≈ total − last fixed). */
export function lastFixedWaterCharge(
  bills: Pick<PropertyBill, "propertyId" | "billType" | "dueDate" | "lineItems">[],
  propertyId: string,
): number | null {
  const itemised = bills
    .filter((b) => b.propertyId === propertyId && b.billType === "Water")
    .filter((b) =>
      (b.lineItems ?? []).some((li) => classifyWaterCharge(li.description) === "usage"),
    )
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const latest = itemised[0];
  if (!latest) return null;
  const fixed = (latest.lineItems ?? [])
    .filter((li) => classifyWaterCharge(li.description) === "fixed")
    .reduce((s, li) => s + Number(li.amount), 0);
  return fixed > 0 ? round2(fixed) : null;
}
