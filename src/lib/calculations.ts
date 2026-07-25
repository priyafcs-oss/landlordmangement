import type { RentFrequency, Tenant, LedgerEntry, TenantInvoice } from "./types";

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
      // Charge the full nominal rent per cycle (avoids float drift from daily-rate rounding).
      const cycleAmount = tenant.rentAmount;
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
): { inArrears: boolean; amount: number } {
  const { total } = buildTenantLedger(tenant, entries, invoices);
  return { inArrears: total > 0.01, amount: total };
}

export function paidUpToDateFromPayments(tenant: Tenant, entries: LedgerEntry[]): string {
  const rate = dailyRentRate(tenant.rentAmount, tenant.rentFrequency);
  const start = tenant.leaseStart ?? tenant.paidUpToDate;
  if (rate <= 0) return start;
  const totalPaid = entries
    .filter((e) => e.tenantId === tenant.id && e.type === "Rent Payment")
    .reduce((s, e) => s + e.credit, 0);
  // Full days covered by paid amount, then advance from lease start.
  const daysCovered = Math.floor(totalPaid / rate);
  return addDays(start, Math.max(0, daysCovered - 1));
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
