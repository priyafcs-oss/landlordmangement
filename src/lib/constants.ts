import type { BillType } from "@/lib/types";

export const BILL_TYPES: BillType[] = [
  "Water",
  "Council Rates",
  "Land Tax",
  "Strata",
  "Insurance",
  "Electricity",
  "Gas",
  "Other",
];

/** Below this, an AI extraction shows a "double-check every field" warning. */
export const LOW_CONFIDENCE_THRESHOLD = 0.85;

/** Sentinel for "no specific dwelling" in a Dwelling select — Radix Select item values can't be an
 * empty string, and shared/whole-property genuinely needs its own selectable option. */
export const SHARED_UNIT = "__shared__";

/** A short random id with a type prefix, e.g. uid("li") → "li_k3j9x0q2". */
export const uid = (prefix: string) => prefix + "_" + Math.random().toString(36).slice(2, 10);

/** How far ahead (in days) each kind of expiry starts showing as an alert — one set of numbers for
 * the Dashboard, Copilot's context, the Overview and the insurance/provider-document badges. */
export const ALERT_WINDOW_DAYS = {
  leaseExpiry: 60,
  warrantyExpiry: 90,
  insuranceRenewal: 30,
  documentExpiry: 30,
} as const;
