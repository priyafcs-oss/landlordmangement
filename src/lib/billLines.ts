import { uid } from "@/lib/constants";
import { planRecharge, rechargeChargeType } from "@/lib/recharge";
import type { BillLineItem, BillType, TenantInvoice } from "@/lib/types";
import { canRechargeLine } from "@/lib/waterSplit";

/** One editable line on a bill — shared by the first-time review (AddBillDialog) and a saved
 * bill (BillDetailDialog) through BillLineItemsEditor. `recharged` is set once a tenant invoice
 * has gone out for the line, which locks its recharge. */
export interface BillLineRow {
  key: string;
  description: string;
  category: BillType;
  amount: string;
  gst: string;
  rechargeToTenant: boolean;
  tenantId: string;
  recharged: boolean;
}

export function blankBillLine(category: BillType, over: Partial<BillLineRow> = {}): BillLineRow {
  return {
    key: uid("li"),
    description: "",
    category,
    amount: "",
    gst: "",
    rechargeToTenant: false,
    tenantId: "",
    recharged: false,
    ...over,
  };
}

export function billLinesToRows(
  items: BillLineItem[] | undefined,
  fallbackCategory: BillType,
): BillLineRow[] {
  return (items ?? []).map((li) =>
    blankBillLine((li.category as BillType) ?? fallbackCategory, {
      description: li.description,
      amount: String(li.amount),
      gst: li.gst !== undefined ? String(li.gst) : "",
      rechargeToTenant: !!li.rechargeToTenant,
      tenantId: li.tenantId ?? "",
      recharged: !!li.recharged,
    }),
  );
}

/** Whether this line should be recharged on save — ticked, and allowed (on a water bill only the
 * usage line can be). A tick on a line later retyped as a fixed charge is ignored. */
export function lineWantsRecharge(billType: string, row: BillLineRow): boolean {
  return row.rechargeToTenant && canRechargeLine(billType, row.category, row.description);
}

/** Lines that are newly being recharged on this save (ticked, tenant picked, no invoice yet). */
export function newlyRechargedLines(billType: string, rows: BillLineRow[]): BillLineRow[] {
  return rows.filter((r) => lineWantsRecharge(billType, r) && r.tenantId && !r.recharged);
}

/**
 * What saving the lines does: the BillLineItem[] to store and the tenant invoices to create.
 * Uses planRecharge, so a line is invoiced at most once however many times the bill is re-saved.
 */
export function planBillLines(
  rows: BillLineRow[],
  opts: { billType: BillType; date: string },
): { lineItems: BillLineItem[]; invoices: Omit<TenantInvoice, "id">[] } {
  const invoices: Omit<TenantInvoice, "id">[] = [];
  const lineItems = rows
    .filter((r) => parseFloat(r.amount) > 0)
    .map((r) => {
      const amount = parseFloat(r.amount) || 0;
      const description = r.description || opts.billType;
      const recharge = planRecharge({
        wanted: lineWantsRecharge(opts.billType, r),
        tenantId: r.tenantId,
        alreadyRecharged: r.recharged,
        chargeType: rechargeChargeType(opts.billType),
        amount,
        date: opts.date,
        description,
      });
      if (recharge.invoice) invoices.push(recharge.invoice);
      return {
        description,
        category: r.category,
        amount,
        gst: r.gst ? parseFloat(r.gst) : undefined,
        rechargeToTenant: recharge.rechargeToTenant || recharge.recharged || undefined,
        tenantId:
          recharge.rechargeToTenant || recharge.recharged ? r.tenantId || undefined : undefined,
        recharged: recharge.recharged || undefined,
      };
    });
  return { lineItems, invoices };
}
