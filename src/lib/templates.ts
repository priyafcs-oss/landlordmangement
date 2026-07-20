import { fmtCurrency } from "./calculations";
import type { Tenant, Property } from "./types";

export type TemplateKey = "arrears" | "inspection" | "renewal";

export interface TemplateInput {
  tenant: Tenant;
  property?: Property;
  outstanding: number;
}

export const TEMPLATES: { key: TemplateKey; label: string }[] = [
  { key: "arrears", label: "7-Day Friendly Arrears Notice" },
  { key: "inspection", label: "14-Day Formal Inspection Notice" },
  { key: "renewal", label: "Lease Expiry & Renewal Offer" },
];

export function renderTemplate(key: TemplateKey, { tenant, property, outstanding }: TemplateInput): string {
  const addr = property?.address ?? "your rental property";
  const ref = tenant.bankReference || "your bank reference";
  const expiry = tenant.leaseExpiry || "the end of your current term (periodic)";
  switch (key) {
    case "arrears":
      return `Dear ${tenant.name},

We hope you are well. This is a friendly reminder that our records show an outstanding balance of ${fmtCurrency(
        outstanding,
      )} on your account for ${addr}.

To avoid any formal notices, please arrange payment within the next 7 days using your reference code ${ref}.

If you have already made this payment, please disregard this message and reply with a receipt so we can reconcile.

Kind regards,
The Landlord`;
    case "inspection":
      return `Dear ${tenant.name},

This is formal notice that a routine inspection will be conducted at ${addr} in accordance with your tenancy agreement. Please consider this your 14-day notice.

Proposed inspection date: (to be confirmed).

If the proposed time is not suitable, please contact us to arrange an alternative.

Kind regards,
The Landlord`;
    case "renewal":
      return `Dear ${tenant.name},

Your lease at ${addr} is scheduled to expire on ${expiry}. We have valued you as a tenant and would like to offer a renewal of your tenancy.

Current rent: ${fmtCurrency(tenant.rentAmount)} ${tenant.rentFrequency}.

Please let us know within the next 14 days whether you would like to renew, and we can prepare the paperwork.

Kind regards,
The Landlord`;
  }
}
