import type { RentFrequency, Tenant, LedgerEntry, TenantInvoice } from "./types";

export function dailyRentRate(amount: number, freq: RentFrequency): number {
  if (freq === "Weekly") return amount / 7;
  if (freq === "Fortnightly") return amount / 14;
  return (amount * 12) / 365;
}

export function periodDays(freq: RentFrequency): number {
  if (freq === "Weekly") return 7;
  if (freq === "Fortnightly") return 14;
  return 30; // approximate cycle for milestone display
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
 * Build the full running-balance ledger for a tenant by combining:
 * - Structural rent-due milestones from lease start to today
 * - Actual credit payments recorded in ledger table
 * - Outstanding invoice charges
 */
export function buildTenantLedger(
  tenant: Tenant,
  entries: LedgerEntry[],
  invoices: TenantInvoice[],
): { rows: LedgerRow[]; outstandingRent: number; outstandingInvoices: number; total: number; nextDue: string } {
  const rate = dailyRentRate(tenant.rentAmount, tenant.rentFrequency);
  const period = periodDays(tenant.rentFrequency);
  const rows: LedgerRow[] = [];

  // Rent due milestones from lease start to today
  const today = todayISO();
  let cursor = tenant.leaseStart;
  while (cursor <= today && cursor <= tenant.leaseExpiry) {
    const end = addDays(cursor, period - 1);
    const cycleAmount = rate * period;
    rows.push({
      id: `due-${tenant.id}-${cursor}`,
      date: cursor,
      description: `Rent Due: ${cursor} to ${end}`,
      debit: Math.round(cycleAmount * 100) / 100,
      credit: 0,
      balance: 0,
      isDue: true,
    });
    cursor = addDays(cursor, period);
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

  const outstandingRent = Math.max(0, running - unpaidInvoiceTotal(tenant.id, invoices));
  const outstandingInvoices = unpaidInvoiceTotal(tenant.id, invoices);
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
  if (rate <= 0) return tenant.leaseStart;
  const totalPaid = entries
    .filter((e) => e.tenantId === tenant.id && e.type === "Rent Payment")
    .reduce((s, e) => s + e.credit, 0);
  const daysCovered = Math.floor(totalPaid / rate);
  return addDays(tenant.leaseStart, daysCovered - 1 < 0 ? 0 : daysCovered - 1);
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
