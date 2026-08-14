import type { RentFrequency, Tenant, LedgerEntry, TenantInvoice, Inspection, Property, RentChange } from "./types";

export function periodDays(freq: RentFrequency): number {
  if (freq === "Weekly") return 7;
  if (freq === "Fortnightly") return 14;
  return 30; // monthly cycle length used for structural milestone display
}

export function dailyRentRate(amount: number, freq: RentFrequency): number {
  // Weekly = amount / 7 (7 days per week — never 6)
  // Fortnightly = amount / 14
  // Monthly = amount * 12 / 365 (annualised)
  if (freq === "Weekly") return amount / 7;
  if (freq === "Fortnightly") return amount / 14;
  return (amount * 12) / 365;
}

/**
 * The rent actually in effect on `date`, accounting for the tenant's rent-change history —
 * `tenant.rentAmount` alone is only the CURRENT rate, and using it for the whole tenancy back to
 * lease start silently applies every rent increase retroactively from day one.
 */
export function rentAmountOnDate(tenant: Tenant, rentChanges: RentChange[], date: string): number {
  const relevant = [...rentChanges]
    .filter((rc) => rc.tenantId === tenant.id)
    .sort((a, b) => (a.changeDate < b.changeDate ? -1 : a.changeDate > b.changeDate ? 1 : 0));
  if (relevant.length === 0) return tenant.rentAmount;
  let amount = relevant[0].oldRent;
  for (const rc of relevant) {
    if (rc.changeDate <= date) amount = rc.newRent;
    else break;
  }
  return amount;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((db - da) / 86400000);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Routine inspection cadence — kept as one constant so the Dashboard alert and the Inspections page never disagree. */
export const INSPECTION_CADENCE_DAYS = 180;

/** A property's configured inspection frequency (months), converted to days — falls back to the app default. */
export function propertyInspectionCadenceDays(property: Property | undefined): number {
  return property?.inspectionFrequencyMonths ? property.inspectionFrequencyMonths * 30 : INSPECTION_CADENCE_DAYS;
}

export function lastCompletedInspection(propertyId: string, inspections: Inspection[]): Inspection | undefined {
  return inspections
    .filter((i) => i.propertyId === propertyId && i.status === "Completed")
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

export interface InspectionDueStatus {
  last: Inspection | undefined;
  daysSinceLast: number | null;
  dueDate: string | null;
  overdue: boolean;
}

/** `cadenceDays` lets a property override the default 6-month routine-inspection cadence (see Property.inspectionFrequencyMonths). */
export function inspectionDueStatus(
  propertyId: string,
  inspections: Inspection[],
  cadenceDays: number = INSPECTION_CADENCE_DAYS,
): InspectionDueStatus {
  const last = lastCompletedInspection(propertyId, inspections);
  if (!last) return { last: undefined, daysSinceLast: null, dueDate: null, overdue: true };
  const daysSinceLast = daysBetween(last.date, todayISO());
  const dueDate = addDays(last.date, cadenceDays);
  return { last, daysSinceLast, dueDate, overdue: daysSinceLast > cadenceDays };
}

export interface LedgerRow {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number; // positive = tenant owes, negative = in credit
  isDue?: boolean;
  entryId?: string; // if from ledger entry (payment)
  canDelete?: boolean;
  source?: LedgerEntry["source"];
}

/**
 * Build the full running-balance ledger for a tenant.
 * Weekly rent cycles are 7 days; a cycle spans cursor .. cursor+period-1 inclusive
 * (7 calendar days for weekly, 14 for fortnightly).
 */
export function buildTenantLedger(
  tenant: Tenant,
  entries: LedgerEntry[],
  invoices: TenantInvoice[],
  rentChanges: RentChange[] = [],
): { rows: LedgerRow[]; outstandingRent: number; outstandingInvoices: number; total: number; nextDue: string } {
  const period = periodDays(tenant.rentFrequency);
  const rows: LedgerRow[] = [];

  // Rent due milestones from lease start to today
  const today = todayISO();
  if (tenant.leaseStart) {
    let cursor: string = tenant.leaseStart;
    const cap = tenant.leaseExpiry || "9999-12-31";
    while (cursor <= today && cursor <= cap) {
      // Cycle spans `period` calendar days: cursor (day 1) ... cursor+period-1 (day 7 for weekly).
      const cycleEnd = addDays(cursor, period - 1);
      // Charge the rent that was actually in effect at the start of this cycle — not today's
      // rate applied retroactively to every past cycle.
      const cycleAmount = rentAmountOnDate(tenant, rentChanges, cursor);
      rows.push({
        id: `due-${tenant.id}-${cursor}`,
        date: cursor,
        description: `Rent Due: ${cursor} → ${cycleEnd} (${period} days)`,
        debit: Math.round(cycleAmount * 100) / 100,
        credit: 0,
        balance: 0,
        isDue: true,
      });
      cursor = addDays(cursor, period);
    }
  }

  // Add credit payments (from ledger entries)
  entries
    .filter((e) => e.tenantId === tenant.id)
    .forEach((e) => {
      rows.push({
        id: e.id,
        date: e.date,
        description: `${e.type}: ${e.description}`,
        debit: e.debit,
        credit: e.credit,
        balance: 0,
        entryId: e.id,
        canDelete: true,
        source: e.source,
      });
    });

  // Add invoice charges
  invoices
    .filter((i) => i.tenantId === tenant.id)
    .forEach((inv) => {
      rows.push({
        id: `inv-${inv.id}`,
        date: inv.dateIssued,
        description: `${inv.chargeType} Invoice ${inv.description ? "- " + inv.description : ""}`,
        debit: inv.status === "Unpaid" ? inv.amountDue : 0,
        credit: inv.status === "Paid" ? inv.amountDue : 0,
        balance: 0,
      });
    });

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.isDue ? -1 : 1));

  let running = 0;
  for (const r of rows) {
    running += r.debit - r.credit;
    r.balance = Math.round(running * 100) / 100;
  }

  const outstandingInvoices = unpaidInvoiceTotal(tenant.id, invoices);
  const outstandingRent = Math.max(0, running - outstandingInvoices);
  const total = Math.round(running * 100) / 100;
  const nextDue = addDays(tenant.paidUpToDate, 1);

  return { rows, outstandingRent, outstandingInvoices, total, nextDue };
}

function unpaidInvoiceTotal(tenantId: string, invoices: TenantInvoice[]) {
  return invoices
    .filter((i) => i.tenantId === tenantId && i.status === "Unpaid")
    .reduce((s, i) => s + i.amountDue, 0);
}

export function tenantArrearsStatus(
  tenant: Tenant,
  entries: LedgerEntry[],
  invoices: TenantInvoice[],
  rentChanges: RentChange[] = [],
): { inArrears: boolean; amount: number } {
  const { total } = buildTenantLedger(tenant, entries, invoices, rentChanges);
  return { inArrears: total > 0.01, amount: total };
}

export interface PaidUpToInfo {
  date: string;
  /** Leftover amount paid beyond the last fully-covered day (e.g. $15 credit sitting past "paid up to"). */
  extra: number;
}

export function paidUpToDetails(tenant: Tenant, entries: LedgerEntry[], rentChanges: RentChange[] = []): PaidUpToInfo {
  const start = tenant.leaseStart ?? tenant.paidUpToDate;
  // Rent Payment and Adjustment/Manual credits all advance the paid-up date; an Adjustment
  // Debit (e.g. a clawed-back shortfall) pulls it back — previously only "Rent Payment" counted,
  // so adjustments silently had no effect on this date at all.
  const totalPaid = entries
    .filter((e) => e.tenantId === tenant.id)
    .reduce((s, e) => {
      if (e.type === "Rent Payment" || e.type === "Adjustment Credit" || e.type === "Manual Credit") {
        return s + e.credit;
      }
      if (e.type === "Adjustment Debit") {
        return s - e.debit;
      }
      return s;
    }, 0);

  const EPS = 1e-8;
  // Walk forward day by day from lease start, consuming totalPaid against whatever rent was
  // actually in effect on each day — a flat totalPaid/rate division only works when the rent
  // never changed; with a mid-tenancy increase it silently applies the current rate to every
  // past day too, which both overstates and understates how many days are actually covered.
  let remaining = totalPaid;
  let fullDays = 0;
  let cursor = start;
  const MAX_DAYS = 20000; // safety cap (~55 years) against a zero/negative-rate infinite loop
  while (fullDays < MAX_DAYS) {
    const dayRate = dailyRentRate(rentAmountOnDate(tenant, rentChanges, cursor), tenant.rentFrequency);
    if (dayRate <= 0 || remaining + EPS < dayRate) break;
    remaining -= dayRate;
    fullDays += 1;
    cursor = addDays(cursor, 1);
  }

  const extra = Math.round(Math.max(0, remaining) * 100) / 100;
  // Floor at "nothing paid" (start - 1 day, matching the tenant's initial default), not at
  // `start` itself — the previous Math.max(0, ...) clamp meant zero payment still advanced the
  // paid-up date by one free day the moment any ledger entry triggered a recompute.
  return { date: addDays(start, Math.max(-1, fullDays - 1)), extra };
}

export function paidUpToDateFromPayments(tenant: Tenant, entries: LedgerEntry[], rentChanges: RentChange[] = []): string {
  return paidUpToDetails(tenant, entries, rentChanges).date;
}

export function daysUntil(dateISO: string): number {
  return daysBetween(todayISO(), dateISO);
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

export function ausFinancialYear(dateISO: string): string {
  const d = new Date(dateISO);
  const y = d.getFullYear();
  const m = d.getMonth();
  return m >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function fyRange(fy: string): { start: string; end: string } {
  const [start] = fy.split("-").map((s) => parseInt(s, 10));
  return { start: `${start}-07-01`, end: `${start + 1}-06-30` };
}

/** Add whole months and return ISO date */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
