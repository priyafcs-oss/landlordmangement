import type { TenantInvoice } from "@/lib/types";
import { addDays } from "@/lib/calculations";

/** The tenant-invoice charge type for a recharge — the only distinction it carries is water usage
 * vs anything else. Takes either a bill's type ("Water") or an expense's category ("Water
 * Charges"), so bills and expenses can't map differently. */
export function rechargeChargeType(
  billTypeOrCategory: string | undefined,
): TenantInvoice["chargeType"] {
  return billTypeOrCategory === "Water" || billTypeOrCategory === "Water Charges"
    ? "Water Usage"
    : "Other";
}

/**
 * The one rule for what a save does about "Recharge to tenant", for every bill line and expense:
 * - invoice the tenant only when recharge is wanted, a tenant is picked, and this item hasn't
 *   already been invoiced — re-saving or editing never invoices twice;
 * - once invoiced, `recharged` stays set even if the box is later unticked — the invoice has
 *   gone out, and losing the flag is what let a later edit invoice the same charge again.
 * `wanted` should already include any can-this-line-be-recharged gate (see canRechargeLine).
 */
export function planRecharge(input: {
  wanted: boolean;
  tenantId?: string;
  alreadyRecharged?: boolean;
  chargeType: TenantInvoice["chargeType"];
  amount: number;
  date: string;
  description: string;
}): { invoice?: Omit<TenantInvoice, "id">; rechargeToTenant: boolean; recharged: boolean } {
  const recharging = input.wanted && !!input.tenantId;
  const invoice =
    recharging && !input.alreadyRecharged && input.amount > 0
      ? buildRechargeInvoice({
          tenantId: input.tenantId!,
          chargeType: input.chargeType,
          amount: input.amount,
          date: input.date,
          description: input.description,
        })
      : undefined;
  return {
    invoice,
    rechargeToTenant: recharging,
    recharged: !!input.alreadyRecharged || !!invoice,
  };
}

/** Builds the TenantInvoice for recharging one expense/bill line item to a tenant. Anchors the
 * 14-day due date to the item's own date (not "today"), so a backdated entry still gets an
 * economically correct due date regardless of which dialog it was recharged from. */
export function buildRechargeInvoice(input: {
  tenantId: string;
  chargeType: TenantInvoice["chargeType"];
  amount: number;
  date: string;
  description: string;
}): Omit<TenantInvoice, "id"> {
  return {
    tenantId: input.tenantId,
    chargeType: input.chargeType,
    amountDue: input.amount,
    dateIssued: input.date,
    dueDate: addDays(input.date, 14),
    status: "Unpaid",
    description: input.description,
  };
}
