import type {
  RentFrequency,
  Tenant,
  LedgerEntry,
  LedgerType,
  TenantInvoice,
  Inspection,
  Property,
  RentChange,
  Expense,
  Loan,
  PropertyBill,
  AiIntakeProposal,
  BillType,
  DepreciationItem,
  ExpenseCategory,
  IncomeCategory,
  LeaseDuration,
} from "./types";
import { categoryGroupOf } from "./types";
import { propertyLabel } from "@/lib/format";


/** Which Property annual-running-cost column each bill type feeds, if any — mirrors
 * ANNUAL_COST_FIELD in supabase/functions/parse-inbound-bill/parse-bill.ts. Duplicated there
 * rather than shared since edge functions (Deno) and the app (Vite) don't share a module
 * system; kept as a single source of truth here on the app side. */
export const ANNUAL_COST_FIELD: Partial<Record<BillType, keyof Property>> = {
  "Council Rates": "councilRatesAnnual",
  Water: "waterRatesAnnual",
  Strata: "strataFeesAnnual",
  Insurance: "insuranceAnnual",
  "Land Tax": "landTaxAnnual",
};

/** Categories offered on a transaction's line items — broader than BillType since a one-off
 * transaction can be almost anything, not just a recurring utility/rates bill. */
export {
  EXPENSE_CATEGORIES,
  CATEGORY_GROUPS,
  categoryGroupOf,
  INCOME_CATEGORIES,
  type ExpenseCategory,
  type CategoryGroup,
  type IncomeCategory,
} from "./types";

/** Short display label for a category's tax treatment — the same four groups categoryGroupOf
 * resolves to, worded the way a landlord (not the ATO) would read them in a table column. An
 * income-only category (not in CATEGORY_GROUPS) or a legacy unrecognised value both fall through
 * to "—" rather than the misleading "Capital Cost" that expenseCategoryToTaxCategory's binary
 * default would imply. */
export function taxTreatmentLabel(category?: string | null): string {
  switch (categoryGroupOf(category)) {
    case "Running Expenses":
      return "Immediate Deduction";
    case "Depreciation":
      return "Depreciation";
    case "Cost Base (Capital)":
      return "Capital Cost";
    case "Non-Deductible":
      return "Non-Deductible";
    default:
      return "—";
  }
}

/** Only the "Running Expenses" group is an immediate deduction — Depreciation, Cost Base
 * (Capital), and Non-Deductible items all fall on the "Capital Works" side of this coarser
 * two-value field (unclaimed this year, whether because they're capitalised or not deductible at
 * all). An unrecognised category defaults to "Capital Works" too, so an unmapped value never
 * silently overclaims a deduction. */
export function expenseCategoryToTaxCategory(category: string): Expense["taxCategory"] {
  return categoryGroupOf(category) === "Running Expenses" ? "Immediate Deduction" : "Capital Works";
}

/** Maps a ledger entry's own bookkeeping type (LedgerType — what a rent-ledger row is FOR, used
 * to compute a tenant's paid-up-to date) onto the app's standard income taxonomy (IncomeCategory —
 * what Transactions/the P&L display as "Category"). These are deliberately two separate enums:
 * LedgerType exists purely to drive paid-up-to bookkeeping (see recomputePaidUp), and was never
 * meant to double as a display category. A switch (not a lookup object) so adding a new LedgerType
 * without extending this mapping is a compile error, not a silent "whatever string it was" leak
 * onto the Transactions Category column — the exact bug this fixes (a "Water Invoice" ledger type
 * showing verbatim as the category instead of "Other Rental Income"). */
export function ledgerTypeToIncomeCategory(type: LedgerType): IncomeCategory {
  switch (type) {
    case "Rent Payment":
      return "Gross Rent";
    case "Water Invoice":
    case "Maintenance Charge":
    case "Manual Credit":
    case "Adjustment Credit":
    case "Adjustment Debit":
    case "Rent Due":
      return "Other Rental Income";
    default: {
      // Exhaustiveness guard: if LedgerType ever gains a new member without a case added above,
      // `type` stops being assignable to `never` here and this file fails to compile — the
      // opposite of the old behaviour, where an unmapped value would have silently displayed
      // whatever raw string it was.
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/** Rounds to whole cents — the one copy (was written out inline in a dozen places). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sensible starting category for a bill based on its recurring billType, used to default the
 * new ATO Category field when a bill type is chosen/extracted — the two fields are otherwise
 * independent (billType drives auto-matching/annual-cost tracking; category drives tax
 * treatment), so this is a one-time default, not a sync. */
export function billTypeToDefaultCategory(billType: BillType): ExpenseCategory {
  switch (billType) {
    case "Water":
      return "Water Charges";
    case "Council Rates":
      return "Council Rates";
    case "Land Tax":
      return "Land Tax";
    case "Strata":
      return "Strata Levies";
    case "Insurance":
      return "Insurance";
    case "Electricity":
      return "Electricity";
    case "Gas":
      return "Gas";
    default:
      return "Sundry Rental Expenses";
  }
}

/** Bill-type / expense-category classifiers for AI-extracted text — the same module the edge
 * functions use (one copy, so the app and the server can't classify a bill differently). */
export { mapBillType, mapExpenseCategory } from "../../supabase/functions/_shared/classify.ts";

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

/** Date-only arithmetic in UTC throughout. Mixing a UTC parse with a local-time setDate lost a
 * day for every date after a daylight-saving start (e.g. NSW, 4 Oct 2026): 10:00 AEST became
 * 10:00 AEDT = 23:00 UTC the day before, so a weekly rent cycle read 03 → 08 instead of 03 → 09. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((db - da) / 86400000);
}

/** Today's LOCAL calendar date — toISOString() is the UTC date, which in Sydney is still
 * yesterday until 10 or 11am. */
export function todayISO(): string {
  return localISO(new Date());
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function weekdayName(iso: string): string {
  if (!iso) return "Mon";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Mon";
  return WEEKDAY_LABELS[(d.getUTCDay() + 6) % 7];
}

export function formatDateWithWeekday(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${weekdayName(iso)}, ${d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}

export function activeRentCycleStartDay(tenant: Tenant, referenceDate: string = todayISO()): Weekday {
  const selected = (tenant.rentCycleStartDay ?? "Mon") as Weekday;
  const leaseDefault = (tenant.leaseStart ? weekdayName(tenant.leaseStart) : "Mon") as Weekday;
  if (tenant.rentFrequency !== "Weekly") return selected;

  // Before the effective date, the cycle follows the original lease-start weekday (or Monday if
  // nothing was ever set). After the effective date, the custom cycle selection takes over.
  const effectiveFrom = tenant.rentCycleStartDayEffectiveFrom;
  if (!effectiveFrom) return selected;

  const ref = new Date(`${referenceDate}T12:00:00Z`);
  const effective = new Date(`${effectiveFrom}T12:00:00Z`);
  return ref >= effective ? selected : leaseDefault;
}

export function tenantCycleLabel(tenant: Tenant): string {
  const start = activeRentCycleStartDay(tenant) as (typeof WEEKDAY_LABELS)[number];
  const index = WEEKDAY_LABELS.indexOf(start);
  const end = WEEKDAY_LABELS[(index + 6) % WEEKDAY_LABELS.length];
  return `${start}–${end}`;
}

export function tenantCycleStartDate(tenant: Tenant, referenceDate: string = todayISO()): string {
  const anchor = tenant.leaseStart || referenceDate;
  if (tenant.rentFrequency !== "Weekly" || !tenant.rentCycleStartDay) return anchor;
  const startDay = activeRentCycleStartDay(tenant, referenceDate) as (typeof WEEKDAY_LABELS)[number];
  const dayIndex = WEEKDAY_LABELS.indexOf(startDay);
  const ref = new Date(`${referenceDate}T12:00:00Z`);
  const diff = (ref.getUTCDay() + 6) % 7 - dayIndex;
  const start = new Date(ref);
  start.setUTCDate(ref.getUTCDate() - diff);
  return localISO(start);
}

/** A Date's LOCAL calendar date as YYYY-MM-DD — use instead of toISOString().slice(0, 10) for a
 * Date built from local fields (new Date(y, m, d), setMonth, ...), which would read back as UTC. */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Formats a created_at/updatedAt ISO timestamp for "last modified" displays (Transactions,
 * Bills) — includes the time, not just the date, since same-day edits are the common case these
 * displays exist to surface. Returns null for an absent/invalid timestamp so callers can fall
 * back to their own "—"/empty state. */
export function fmtModified(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
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
  invoiceId?: string; // if from a tenant invoice (e.g. a recharged bill line item)
  /** Derived, never stored: whether the tenant's payments (applied to the oldest charge first)
   * have covered this invoice yet — see buildTenantLedger. */
  invoiceStatus?: "Paid" | "Part paid" | "Unpaid";
  canDelete?: boolean;
  source?: LedgerEntry["source"];
}

/** Incoming rent recorded from a bank feed goes on the tenant's own ledger, not into Expenses —
 * that's what advances their paid-up-to date and shows on the Rental hub, and ledger entries
 * already appear in Transactions (as Gross Rent), so recording it both ways would count it twice. */
export const RENT_INCOME_CATEGORY = "Gross Rent";

/** Which tenant an incoming rent deposit at this property most likely belongs to: whoever has the
 * most recent ledger entry — a property keeps its past tenants on file, so "the only tenant" or
 * "the first one" would often pick someone who moved out long ago. */
export function likelyRentTenantId(tenants: Tenant[], ledger: LedgerEntry[], propertyId: string): string | undefined {
  const lastPaid = new Map<string, string>();
  for (const e of ledger) if (e.date > (lastPaid.get(e.tenantId) ?? "")) lastPaid.set(e.tenantId, e.date);
  return tenants
    .filter((t) => t.propertyId === propertyId)
    .sort((a, b) => (lastPaid.get(b.id) ?? "").localeCompare(lastPaid.get(a.id) ?? ""))[0]?.id;
}

/** A ledger entry for something the tenant is recharged for (not rent) — it never advances the
 * paid-up-to date, see paidUpToDetails. */
function isNonRentRecharge(e: LedgerEntry): boolean {
  return e.type === "Water Invoice" || e.type === "Maintenance Charge";
}

/** What a ledger entry charges the tenant's account. A recharge line on an agent statement
 * (water usage, ...) is the tenant paying a charge that was never itself posted here — on its own
 * it read as pure credit, so every water payment made the tenant look that much ahead on rent.
 * It's charged-and-paid on the one row, so it nets to zero. */
function entryDebit(e: LedgerEntry): number {
  return isNonRentRecharge(e) && e.credit > 0 && !e.debit ? e.credit : e.debit;
}

/**
 * Build the full running-balance ledger for a tenant — one plain debit/credit account: rent
 * cycles, invoices and debit entries are charges, and every payment is a credit against the whole
 * balance. Invoices are always charges whatever their stored status (tenants pay them inside
 * their normal rent transfers, so nobody has to "mark paid"); each invoice row's status is derived
 * by applying all credits to the oldest charges first.
 * Weekly rent cycles are 7 days; a cycle spans cursor .. cursor+period-1 inclusive
 * (7 calendar days for weekly, 14 for fortnightly).
 */
export function buildTenantLedger(
  tenant: Tenant,
  entries: LedgerEntry[],
  invoices: TenantInvoice[],
  rentChanges: RentChange[] = [],
): {
  rows: LedgerRow[];
  /** Closing balance — includes the whole current rent cycle, charged in advance on its first day. */
  total: number;
  /** What's actually owed as of today: the closing balance less the part of the current cycle
   * still to come. A tenant paid up to today or later never owes anything here. */
  overdue: number;
  outstandingRent: number;
  outstandingInvoices: number;
  nextDue: string;
} {
  const period = periodDays(tenant.rentFrequency);
  const rows: LedgerRow[] = [];

  // Rent due milestones from lease start to today
  const today = todayISO();
  let unaccrued = 0;
  if (tenant.leaseStart) {
    let cursor: string = tenant.leaseStart;
    const cap = tenant.leaseExpiry || "9999-12-31";
    while (cursor <= today && cursor <= cap) {
      // Cycle spans `period` calendar days: cursor (day 1) ... cursor+period-1 (day 7 for weekly).
      const cycleEnd = addDays(cursor, period - 1);
      // Charge the rent actually in effect during this cycle — not today's rate applied
      // retroactively to every past cycle. Most cycles have one constant rate throughout, so
      // charge the flat nominal amount (avoids float drift from daily-rate rounding); only when
      // a rent change actually falls inside this cycle do we pro-rate day by day, so a mid-week
      // change lands in the week it actually took effect rather than being pushed to the next
      // whole cycle.
      const rateAtStart = rentAmountOnDate(tenant, rentChanges, cursor);
      const rateAtEnd = rentAmountOnDate(tenant, rentChanges, cycleEnd);
      let cycleAmount: number;
      if (rateAtStart === rateAtEnd) {
        cycleAmount = rateAtStart;
      } else {
        let sum = 0;
        for (let d = cursor; d <= cycleEnd; d = addDays(d, 1)) {
          sum += dailyRentRate(rentAmountOnDate(tenant, rentChanges, d), tenant.rentFrequency);
        }
        cycleAmount = round2(sum);
      }
      rows.push({
        id: `due-${tenant.id}-${cursor}`,
        date: cursor,
        description: `Rent Due: ${cursor} → ${cycleEnd}`,
        debit: round2(cycleAmount),
        credit: 0,
        balance: 0,
        isDue: true,
      });
      // The not-yet-reached days of the cycle containing today (charged in advance, not owed yet).
      unaccrued = cycleEnd > today ? (cycleAmount * daysBetween(today, cycleEnd)) / period : 0;
      cursor = addDays(cursor, period);
    }
  }

  entries
    .filter((e) => e.tenantId === tenant.id)
    .forEach((e) => {
      rows.push({
        id: e.id,
        date: e.date,
        description: `${e.type}: ${e.description}`,
        debit: entryDebit(e),
        credit: e.credit,
        balance: 0,
        entryId: e.id,
        canDelete: true,
        source: e.source,
      });
    });

  invoices
    .filter((i) => i.tenantId === tenant.id)
    .forEach((inv) => {
      rows.push({
        id: `inv-${inv.id}`,
        date: inv.dateIssued,
        description: `${inv.chargeType} Invoice ${inv.description ? "- " + inv.description : ""}`,
        debit: inv.amountDue,
        credit: 0,
        balance: 0,
        invoiceId: inv.id,
        canDelete: true,
      });
    });

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.isDue ? -1 : 1));

  let running = 0;
  for (const r of rows) {
    running += r.debit - r.credit;
    r.balance = round2(running);
  }

  // Apply every credit to the charges oldest first — whatever isn't covered is still owed.
  let pool = rows.reduce((s, r) => s + r.credit, 0);
  let unpaidInvoices = 0;
  for (const r of rows) {
    if (!r.debit) continue;
    const covered = Math.min(r.debit, Math.max(0, pool));
    pool -= r.debit;
    if (!r.invoiceId) continue;
    const left = r.debit - covered;
    r.invoiceStatus = left < 0.005 ? "Paid" : covered < 0.005 ? "Unpaid" : "Part paid";
    unpaidInvoices += left;
  }

  const total = round2(running);
  const overdue = Math.max(0, round2(running - unaccrued));
  const outstandingInvoices = round2(Math.min(unpaidInvoices, overdue));
  const outstandingRent = round2(overdue - outstandingInvoices);
  const nextDue = addDays(paidUpToDetails(tenant, entries, rentChanges, invoices).date, 1);

  return { rows, total, overdue, outstandingRent, outstandingInvoices, nextDue };
}

export function tenantArrearsStatus(
  tenant: Tenant,
  entries: LedgerEntry[],
  invoices: TenantInvoice[],
  rentChanges: RentChange[] = [],
): { inArrears: boolean; amount: number } {
  const { overdue } = buildTenantLedger(tenant, entries, invoices, rentChanges);
  return { inArrears: overdue > 0.01, amount: overdue };
}

export interface PaidUpToInfo {
  date: string;
  /** Leftover amount paid beyond the last fully-covered day (e.g. $15 credit sitting past "paid up to"). */
  extra: number;
}

/** Paid-up-to date on the one overall account: every credit, less every non-rent charge
 * (invoices, debit entries), is what's left to have paid rent with — so an invoice settled inside
 * a normal rent transfer pulls the date back by exactly that much, with nothing to mark paid. */
export function paidUpToDetails(
  tenant: Tenant,
  entries: LedgerEntry[],
  rentChanges: RentChange[] = [],
  invoices: TenantInvoice[] = [],
): PaidUpToInfo {
  const start = tenant.leaseStart ?? tenant.paidUpToDate;
  const totalPaid =
    entries.filter((e) => e.tenantId === tenant.id).reduce((s, e) => s + e.credit - entryDebit(e), 0) -
    invoices.filter((i) => i.tenantId === tenant.id).reduce((s, i) => s + i.amountDue, 0);

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

/**
 * Re-derives each tenant's stored paidUpToDate from their payments, returning only the tenants
 * whose value changed. Run once on load so a date computed before the addDays DST fix corrects
 * itself. Only a small drift (≤3 days) is healed — anything bigger isn't that bug — and nothing
 * at all when `ledger` is empty: selectAll returns [] on a failed load, which would otherwise wind
 * every tenant back to their lease start.
 */
export function healPaidUpDates(
  tenants: Tenant[],
  ledger: LedgerEntry[],
  rentChanges: RentChange[],
  invoices: TenantInvoice[] = [],
): Tenant[] {
  if (ledger.length === 0) return [];
  const changed: Tenant[] = [];
  for (const t of tenants) {
    if (!t.paidUpToDate) continue;
    const derived = paidUpToDateFromPayments(t, ledger, rentChanges, invoices);
    if (derived === t.paidUpToDate || Math.abs(daysBetween(t.paidUpToDate, derived)) > 3) continue;
    changed.push({ ...t, paidUpToDate: derived });
  }
  return changed;
}

export function paidUpToDateFromPayments(
  tenant: Tenant,
  entries: LedgerEntry[],
  rentChanges: RentChange[] = [],
  invoices: TenantInvoice[] = [],
): string {
  return paidUpToDetails(tenant, entries, rentChanges, invoices).date;
}

export function daysUntil(dateISO: string): number {
  return daysBetween(todayISO(), dateISO);
}

/** A date from today up to `days` ahead (not already past). */
export function isDueWithin(dateISO: string | undefined, days: number): boolean {
  if (!dateISO) return false;
  const d = daysUntil(dateISO);
  return d >= 0 && d <= days;
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

export function ausFinancialYear(dateISO: string): string {
  // `new Date("YYYY-MM-DD")` always parses as UTC midnight -- read it back with the UTC getters
  // too, not the local-time ones, or this misclassifies dates near the FY boundary for anyone
  // whose local timezone sits behind UTC (e.g. the Americas).
  const d = new Date(dateISO);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return m >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function fyRange(fy: string): { start: string; end: string } {
  const [start] = fy.split("-").map((s) => parseInt(s, 10));
  return { start: `${start}-07-01`, end: `${start + 1}-06-30` };
}

/** Financial-year dropdown options, oldest first — "2023-2024", "2024-2025", ... one year ahead
 * of the current FY. `spanBack` controls how many past years are included (most lists only need
 * a handful; a full ledger view may want more). */
export function buildFyOptions(spanBack = 3): string[] {
  const currentYear = new Date().getFullYear();
  const years: string[] = [];
  for (let y = currentYear - spanBack; y <= currentYear + 1; y++) years.push(`${y}-${y + 1}`);
  return years;
}

/** Inclusive day count between two ISO dates — used to pro-rate an annual estimate (loan
 * interest, etc.) to whatever period is actually selected. A full closed FY is ~365 days so this
 * is a no-op for those; a year-to-date period is shorter, so the full-year estimate would
 * otherwise overstate the figure for a year still in progress. */
export function daysInclusive(startISO: string, endISO: string): number {
  return Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 86_400_000) + 1;
}

/** What's still owed on a bill — nothing once Paid; for a Partial instalment, the amount less
 * what's already been paid (paidAmount only counts while Partial, same rule markBillPaid uses).
 * Dashboards and forecasts summing raw `amount` overstated partly-paid bills. */
export function billOwed(b: Pick<PropertyBill, "amount" | "status" | "paidAmount">): number {
  if (b.status === "Paid") return 0;
  return Math.max(0, b.amount - (b.status === "Partial" ? (b.paidAmount ?? 0) : 0));
}

/** A bill still owing money past its due date — Partial included (the old `status === "Unpaid"`
 * check never flagged a part-paid bill as overdue). */
export function isBillOverdue(b: Pick<PropertyBill, "amount" | "status" | "paidAmount" | "dueDate">, today = todayISO()): boolean {
  return b.dueDate < today && billOwed(b) > 0.005;
}

/** A loan's interest for a full year at its current balance and rate — the estimate used when no
 * real interest has been posted from a loan statement. */
export function annualInterestOf(loan: Pick<Loan, "totalBalance" | "interestRate">): number {
  return (loan.totalBalance * loan.interestRate) / 100;
}

/**
 * Estimated loan interest for one property over a period: every non-paid-off loan on it, pro-rated
 * to the period's length. Returns 0 when real "Interest on Loan" expenses were already posted for
 * that property in the period — adding the estimate on top double-counted interest (the tax
 * summary did exactly that, and charged a full year even for a year still in progress).
 */
export function estimateLoanInterest(input: {
  loans: Pick<Loan, "propertyId" | "totalBalance" | "interestRate" | "status">[];
  expenses: Pick<Expense, "propertyId" | "category" | "cost" | "date" | "direction">[];
  propertyId: string;
  start: string;
  end: string;
}): number {
  const { loans, expenses, propertyId, start, end } = input;
  const hasRealInterest = expenses.some(
    (e) => e.propertyId === propertyId && e.category === "Interest on Loan" && e.direction !== "Income" && e.cost !== 0 && e.date >= start && e.date <= end,
  );
  if (hasRealInterest) return 0;
  const annual = loans
    .filter((l) => l.propertyId === propertyId && l.status !== "Paid Off")
    .reduce((s, l) => s + annualInterestOf(l), 0);
  return (annual * daysInclusive(start, end)) / 365;
}

/** Division 43 (capital works) is only ever claimable straight-line (Prime Cost) under ATO rules —
 * unlike Div 40 (plant & equipment) it has no diminishing-value option. The default method for a
 * division, used wherever a depreciation item is created. */
export function defaultMethodForDivision(division: DepreciationItem["division"]): NonNullable<DepreciationItem["method"]> {
  return division === "Div 43" ? "Prime Cost" : "Diminishing Value";
}

/** The method after switching an item's division: Div 43 forces Prime Cost; otherwise the current
 * choice is kept. One rule for every depreciation editor. */
export function methodAfterDivisionChange(
  division: DepreciationItem["division"],
  current: NonNullable<DepreciationItem["method"]>,
): NonNullable<DepreciationItem["method"]> {
  return division === "Div 43" ? "Prime Cost" : current;
}

export interface DepreciationScheduleYear {
  fy: string;
  div40: number;
  div43: number;
  total: number;
}

/**
 * A single item's annual depreciation claim, indexed by year-since-start (index 0 = the first,
 * pro-rated year) rather than by financial year — the building block `buildDepreciationSchedule`
 * folds into a portfolio-wide FY-keyed view, and that the "Add depreciation report" dialog reuses
 * directly to preview a report's own Year 1/2/3… schedule before it has an assetId's worth of
 * financial-year history to anchor to. Prime Cost is a flat cost/life every year for `life` years;
 * Diminishing Value is a standard 200%-declining-balance projection. Both pro-rate their first
 * entry by days held between `startISO` and that financial year's end (30 June), so a mid-year
 * start doesn't overstate year one. Simplified (no low-value pooling, no part-year private-use
 * apportionment beyond first-year day-counting, no pre-2017 150% DV rate) — matches the rigor of
 * the rest of this app's finance screens, not a full ATO Div 40/43 engine.
 */
export function itemAnnualClaims(cost: number, effectiveLifeYears: number, method: DepreciationItem["method"], startISO: string): number[] {
  const life = effectiveLifeYears > 0 ? effectiveLifeYears : 1;
  const start = startISO || todayISO();
  const { end: firstFyEnd } = fyRange(ausFinancialYear(start));
  const daysHeldFirstYear = Math.max(1, Math.min(365, Math.round((new Date(firstFyEnd).getTime() - new Date(start).getTime()) / 86400000) + 1));

  const claims: number[] = [];
  if (method === "Prime Cost") {
    // Pro-rate the first year by days held — otherwise a mid-year purchase claimed a full year's
    // cost/life in its first year (overstating that year) and the schedule fell short of `cost`
    // after exactly `life` years instead of finishing with a matching partial claim at the tail.
    const annual = cost / life;
    let claimed = 0;
    let i = 0;
    while (claimed < cost - 0.01 && i < Math.ceil(life) + 1) {
      const claim = Math.min(i === 0 ? annual * (daysHeldFirstYear / 365) : annual, cost - claimed);
      claims.push(claim);
      claimed += claim;
      i++;
    }
  } else {
    let opening = cost;
    const rate = 2 / life;
    let i = 0;
    while (opening > 1 && i < Math.ceil(life) + 1) {
      const claim = Math.min(i === 0 ? opening * rate * (daysHeldFirstYear / 365) : opening * rate, opening);
      claims.push(claim);
      opening -= claim;
      i++;
    }
  }
  return claims;
}

/** Projects every item's annual depreciation claim across financial years — see
 * `itemAnnualClaims` for the per-item math this aggregates. */
export function buildDepreciationSchedule(items: DepreciationItem[]): DepreciationScheduleYear[] {
  const byFy = new Map<string, { div40: number; div43: number }>();
  const addToFy = (fy: string, division: "Div 40" | "Div 43", amount: number) => {
    const entry = byFy.get(fy) ?? { div40: 0, div43: 0 };
    if (division === "Div 40") entry.div40 += amount;
    else entry.div43 += amount;
    byFy.set(fy, entry);
  };

  // A reportId group with a saved reportAnnualSummary was reviewed against its source document as
  // one whole schedule — read from that single authoritative total per year rather than re-summing
  // each item's own (individually-editable) annualClaims, so the property's depreciation totals
  // always match what the report actually said. Only one pass per reportId; items without a
  // reportId, or an older report saved before this field existed, fall through to the per-item
  // loop below instead.
  const coveredByReportSummary = new Set<string>();
  for (const item of items) {
    if (!item.reportId || !item.reportAnnualSummary?.length || coveredByReportSummary.has(item.reportId)) continue;
    coveredByReportSummary.add(item.reportId);
    const start = item.purchaseDate || item.effectiveFrom || todayISO();
    const startYear = parseInt(ausFinancialYear(start).split("-")[0], 10);
    item.reportAnnualSummary.forEach((y, i) => {
      addToFy(`${startYear + i}-${startYear + i + 1}`, "Div 40", y.div40);
      addToFy(`${startYear + i}-${startYear + i + 1}`, "Div 43", y.div43);
    });
  }

  for (const item of items) {
    if (item.reportId && coveredByReportSummary.has(item.reportId)) continue;
    const division = item.division ?? "Div 40";
    const start = item.purchaseDate || item.effectiveFrom || todayISO();
    const startYear = parseInt(ausFinancialYear(start).split("-")[0], 10);
    // A saved annualClaims schedule is the permanent record (possibly hand-edited to match the
    // source report, or already reflected on a lodged tax return) — only items saved before that
    // field existed fall back to re-deriving it live from cost/life/method.
    const claims = item.annualClaims ?? itemAnnualClaims(item.purchaseCost, item.effectiveLifeYears, item.method ?? "Diminishing Value", start);
    claims.forEach((claim, i) => addToFy(`${startYear + i}-${startYear + i + 1}`, division, claim));
  }

  return Array.from(byFy.entries())
    .map(([fy, v]) => ({
      fy,
      div40: round2(v.div40),
      div43: round2(v.div43),
      total: Math.round((v.div40 + v.div43) * 100) / 100,
    }))
    .sort((a, b) => (a.fy < b.fy ? -1 : 1));
}

/** Last day of a fixed-term lease starting `start` — the day before the same date 6 or 12 months
 * on. "" for a periodic lease or a missing start. */
export function leaseEndDate(start: string, duration: LeaseDuration | ""): string {
  if (!start || !duration || duration === "Periodic") return "";
  return addDays(addMonths(start, duration === "6 Months" ? 6 : 12), -1);
}

/** Add whole months and return ISO date — UTC throughout, same reason as addDays. */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export interface ActivityItem {
  id: string;
  date: string; // ISO date, used for sorting and relative-time display
  label: string;
  amount?: number;
}

/**
 * Recent automated activity, computed client-side from existing provenance fields
 * (Expense.source, LedgerEntry.source, AiIntakeProposal.status) rather than a dedicated
 * activity-log table — nothing here is persisted, it's re-derived on every dashboard load.
 */
export function buildActivityFeed(state: {
  expenses: Expense[];
  ledger: LedgerEntry[];
  aiProposals: AiIntakeProposal[];
  properties: Property[];
  tenants: Tenant[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const e of state.expenses) {
    if (e.source !== "email_auto" && e.source !== "agent_statement") continue;
    const prop = state.properties.find((p) => p.id === e.propertyId);
    items.push({
      id: `exp_${e.id}`,
      date: e.date,
      label: `Matched a bill — ${e.itemName}${prop ? ` · ${propertyLabel(prop)}` : ""}`,
      amount: -e.cost,
    });
  }

  for (const entry of state.ledger) {
    if (entry.source !== "bank_feed" && entry.source !== "agent_statement") continue;
    const tenant = state.tenants.find((t) => t.id === entry.tenantId);
    const prop = tenant ? state.properties.find((p) => p.id === tenant.propertyId) : undefined;
    items.push({
      id: `ledg_${entry.id}`,
      date: entry.date,
      label:
        entry.source === "agent_statement"
          ? `Processed an agent statement${prop ? ` · ${propertyLabel(prop)}` : ""}`
          : `Recorded rent received${tenant ? ` · ${tenant.name}` : ""}`,
      amount: entry.credit || undefined,
    });
  }

  for (const proposal of state.aiProposals) {
    if (proposal.status !== "applied" || !proposal.created_at) continue;
    const prop = state.properties.find((p) => p.id === proposal.propertyId);
    items.push({
      id: `prop_${proposal.id}`,
      date: proposal.created_at.slice(0, 10),
      label: `Filed a ${proposal.kind === "tenant_lease" ? "lease agreement" : "rent statement"}${prop ? ` · ${propertyLabel(prop)}` : ""}`,
    });
  }

  return items.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
}
