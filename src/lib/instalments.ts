import { uid } from "@/lib/constants";
import type { PropertyBill } from "@/lib/types";
import { billOwed } from "@/lib/calculations";

/** One editable row of a bill's payment schedule. `id` is set for an instalment already saved. */
export interface InstalmentRow {
  key: string;
  id?: string;
  label: string;
  dueDate: string;
  amount: string;
}

/** "Instalment 3" — 1-based, the same wording wherever a schedule is created or edited. */
export function instalmentLabel(n: number): string {
  return `Instalment ${n}`;
}

export function newInstalmentRow(n: number, over: Partial<InstalmentRow> = {}): InstalmentRow {
  return { key: uid("inst"), label: instalmentLabel(n), dueDate: "", amount: "", ...over };
}

/** An error message when a schedule can't be saved, else null. */
export function validateInstalments(rows: InstalmentRow[]): string | null {
  if (rows.some((r) => !r.dueDate || !(parseFloat(r.amount) > 0)))
    return "Every instalment needs a due date and amount";
  return null;
}

/** Per-instalment fields that must NOT be copied onto another instalment — payment state, its own
 * amount/date/label, and one-off identifiers (emailMessageId is unique per bill row). */
type PerInstalmentField =
  | "id"
  | "created_at"
  | "updatedAt"
  | "status"
  | "paidDate"
  | "paidAmount"
  | "paymentMethod"
  | "linkedExpenseId"
  | "emailMessageId"
  | "tenantRebillStatus"
  | "amount"
  | "dueDate"
  | "label";

export type SharedBillFields = Omit<PropertyBill, PerInstalmentField>;

/** The fields every instalment in a group shares, taken from any one of them. */
export function sharedBillFields(bill: PropertyBill | SharedBillFields): SharedBillFields {
  const {
    id: _id,
    created_at: _c,
    updatedAt: _u,
    status: _s,
    paidDate: _pd,
    paidAmount: _pa,
    paymentMethod: _pm,
    linkedExpenseId: _le,
    emailMessageId: _em,
    tenantRebillStatus: _tr,
    amount: _a,
    dueDate: _d,
    label: _l,
    ...shared
  } = bill as PropertyBill;
  return shared;
}

/**
 * New unpaid instalment bills for a group, from the shared fields plus each row's own label, date
 * and amount. Used both when a bill is first saved with a schedule and when instalments are added
 * to a saved bill — the latter used to copy only a handful of fields, leaving new instalments
 * without a category/tax category/provider/dwelling (so their P&L posting on payment had none).
 */
export function instalmentBills(
  shared: SharedBillFields,
  rows: InstalmentRow[],
  billGroupId: string,
): Omit<PropertyBill, "id">[] {
  return rows.map((r) => ({
    ...shared,
    billGroupId,
    status: "Unpaid" as const,
    label: r.label,
    dueDate: r.dueDate,
    amount: parseFloat(r.amount) || 0,
  }));
}

export interface InstalmentGroupSummary {
  /** The earliest instalment not yet fully paid (a part-paid one counts), else undefined. */
  next?: PropertyBill;
  /** What's still owed on `next` alone — the amount actually due on its due date. */
  nextOwed: number;
  /** Still owed across the whole schedule. */
  pending: number;
  total: number;
  paidCount: number;
}

/** The collapsed Bills-board row for an instalment schedule: next unpaid instalment and its own
 * amount, plus schedule-wide totals. Pass the WHOLE group, not a filtered slice of it — a status
 * filter hiding the paid instalments must not change what the schedule says is next or owed. */
export function instalmentGroupSummary(group: PropertyBill[]): InstalmentGroupSummary {
  const sorted = [...group].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const next = sorted.find((b) => b.status !== "Paid");
  return {
    next,
    nextOwed: next ? billOwed(next) : 0,
    pending: sorted.reduce((s, b) => s + billOwed(b), 0),
    total: sorted.reduce((s, b) => s + b.amount, 0),
    paidCount: sorted.filter((b) => b.status === "Paid").length,
  };
}
