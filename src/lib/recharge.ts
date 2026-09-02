import type { ExpenseCategory, IncomeCategory } from "@/lib/calculations";
import type { TenantInvoice } from "@/lib/types";

/** The only distinction chargeType ever carries when recharging an Expense line item (as opposed
 * to a Bill, which already has its own real BillType — see billTypeToChargeType) is whether it's
 * a water-usage recharge or not. */
export function chargeTypeForCategory(category: ExpenseCategory | IncomeCategory | undefined): TenantInvoice["chargeType"] {
  return category === "Water Charges" ? "Water Usage" : "Other";
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
    dueDate: new Date(new Date(input.date).getTime() + 14 * 86400000).toISOString().slice(0, 10),
    status: "Unpaid",
    description: input.description,
  };
}
