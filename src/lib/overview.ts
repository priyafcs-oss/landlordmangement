import type { Property, Loan, Expense, LedgerEntry, CashBuffer, InsurancePolicy, ValuationSnapshot, LoanBalanceSnapshot, Asset, Entity } from "./types";
import { addMonths, daysUntil, localISO, todayISO } from "./calculations";

/** Value/debt/equity headline figures for a scope (one property, one entity, or the whole portfolio). */
export interface OverviewMetrics {
  totalValue: number;
  totalDebt: number;
  totalOffset: number;
  equity: number;
  lvrPercent: number;
}

export function computeOverviewMetrics(
  properties: Property[],
  loans: Loan[],
  extraAssetsValue = 0,
): OverviewMetrics {
  const totalValue = properties.reduce((s, p) => s + (p.currentValue || 0), 0) + extraAssetsValue;
  const totalDebt = loans.reduce((s, l) => s + (l.totalBalance || 0), 0);
  const totalOffset = loans.reduce((s, l) => s + (l.offsetBalance || 0), 0);
  const equity = totalValue - totalDebt;
  const lvrPercent = totalValue > 0 ? Math.min(100, Math.round((totalDebt / totalValue) * 100)) : 0;
  return { totalValue, totalDebt, totalOffset, equity, lvrPercent };
}

export interface CashflowMonth {
  name: string;
  income: number;
  expenses: number;
  net: number;
}

export interface CashflowSummary {
  months: CashflowMonth[];
  moneyIn: number;
  moneyOut: number;
  netPerMonth: number;
  projected: number;
}

/** Monthly income vs expenses (opex + loan EMIs) for the trailing `monthsBack` months, plus the
 * latest full month's figures for the headline stat row. */
export function computeCashflowSeries(
  ledger: LedgerEntry[],
  expenses: Expense[],
  loans: Loan[],
  monthsBack: 6 | 12,
): CashflowSummary {
  const totalEmis = loans.reduce((s, l) => s + (l.monthlyEmi || 0), 0);
  const months: CashflowMonth[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    // Day 1 so e.g. 31 Oct minus a month doesn't overflow into 1 Oct; local date, not UTC.
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = localISO(d).slice(0, 7);
    const income = ledger.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.credit, 0);
    const opEx = expenses.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.cost, 0);
    const outgoing = opEx + totalEmis;
    months.push({
      name: d.toLocaleString("en-AU", {
        month: "short",
        year: monthsBack === 12 ? "2-digit" : undefined,
      }),
      income,
      expenses: outgoing,
      net: income - outgoing,
    });
  }
  const last = months[months.length - 1];
  const moneyIn = last?.income ?? 0;
  const moneyOut = last?.expenses ?? 0;
  const netPerMonth = last?.net ?? 0;
  return { months, moneyIn, moneyOut, netPerMonth, projected: netPerMonth };
}

export interface BufferStatus {
  worstPct: number | null;
  worstLabel: string | null;
  fullyCovered: boolean;
}

export function computeBufferStatus(buffers: CashBuffer[]): BufferStatus {
  const withTarget = buffers
    .map((b) => ({
      buffer: b,
      pct:
        b.targetAmount && b.targetAmount > 0
          ? (b.currentBalance / b.targetAmount) * 100
          : undefined,
    }))
    .filter((x): x is { buffer: CashBuffer; pct: number } => x.pct !== undefined)
    .sort((a, b) => a.pct - b.pct);
  const worst = withTarget[0];
  return {
    worstPct: worst ? worst.pct : null,
    worstLabel: worst ? worst.buffer.label : null,
    fullyCovered: withTarget.every((x) => x.pct >= 100),
  };
}

export interface UpcomingRepaymentItem {
  loanId: string;
  bankName: string;
  accountNumber?: string;
  propertyLabel: string;
  repaymentFrequency: string;
  dueDate: string;
  amount: number;
  offsetBalance: number;
  shortfall: boolean;
}

export interface UpcomingRepaymentsSummary {
  dueTotal: number;
  availableTotal: number;
  shortfallTotal: number;
  items: UpcomingRepaymentItem[];
}

/** The per-repayment amount for one loan, whatever its cadence — monthlyEmi is always a monthly
 * figure (see computeCashflowSeries), so a weekly/fortnightly loan's own instalment is derived
 * from it rather than stored separately. */
function perRepaymentAmount(loan: Loan): number {
  const monthly = loan.monthlyEmi || 0;
  if (loan.repaymentFrequency === "Weekly") return (monthly * 12) / 52;
  if (loan.repaymentFrequency === "Fortnightly") return (monthly * 12) / 26;
  return monthly;
}

/** Every occurrence of a recurring date, starting from `fromISO`, that falls within
 * [windowStart, windowEnd] — rolling forward first if `fromISO` is stale (in the past). Bounded so
 * a malformed/very-old date can't loop indefinitely. */
function occurrencesInWindow(fromISO: string, frequency: Loan["repaymentFrequency"], windowStart: Date, windowEnd: Date): Date[] {
  let d = new Date(fromISO.slice(0, 10) + "T00:00:00Z");
  if (isNaN(d.getTime())) return [];
  // UTC steps (and UTC-midnight window bounds below) so a daylight-saving change can't shift a date.
  const step = (date: Date) => {
    const next = new Date(date);
    if (frequency === "Weekly") next.setUTCDate(next.getUTCDate() + 7);
    else if (frequency === "Fortnightly") next.setUTCDate(next.getUTCDate() + 14);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  };
  for (let i = 0; d < windowStart && i < 1000; i++) d = step(d);
  const out: Date[] = [];
  for (let i = 0; d <= windowEnd && i < 100; i++) {
    out.push(d);
    d = step(d);
  }
  return out;
}

/** Where a loan's repayment schedule starts: its next repayment date, or failing that this month's
 * repayment day (`dueDayOfMonth`, clamped to the month's length) — occurrencesInWindow rolls it
 * forward if it's already past. Undefined when neither is on file. */
export function repaymentAnchor(loan: Pick<Loan, "nextRepaymentDate" | "dueDayOfMonth">, todayIso = todayISO()): string | undefined {
  if (loan.nextRepaymentDate) return loan.nextRepaymentDate;
  if (!loan.dueDayOfMonth) return undefined;
  const [y, m] = todayIso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${todayIso.slice(0, 7)}-${String(Math.min(loan.dueDayOfMonth, lastDay)).padStart(2, "0")}`;
}

/** Loan repayments falling due in the next `windowDays`, with each loan's offset balance as the
 * cash already sitting against it — flags a shortfall where the offset can't cover the instalment.
 * The one repayment schedule: the Overview's upcoming-repayments card and the Dashboard's
 * "due within 7 days" alerts both use it (the Dashboard used to build its own, monthly-only, capped
 * at the 28th, showing the monthly figure for weekly loans and including paid-off loans). A loan
 * with neither a next repayment date nor a repayment day is skipped. */
export function computeUpcomingRepayments(loans: Loan[], properties: Property[], windowDays: number): UpcomingRepaymentsSummary {
  const today = new Date(todayISO() + "T00:00:00Z");
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + windowDays);

  const items: UpcomingRepaymentItem[] = [];
  for (const loan of loans) {
    const anchor = repaymentAnchor(loan);
    if (!anchor || loan.status === "Paid Off" || !(loan.monthlyEmi > 0)) continue;
    const dates = occurrencesInWindow(anchor, loan.repaymentFrequency, today, end);
    if (dates.length === 0) continue;
    const amount = perRepaymentAmount(loan);
    const offsetBalance = loan.offsetBalance ?? 0;
    const property = properties.find((p) => p.id === loan.propertyId);
    const propertyLabel = property?.alias || property?.address || "—";
    for (const d of dates) {
      items.push({
        loanId: loan.id,
        bankName: loan.bankName,
        accountNumber: loan.accountNumber,
        propertyLabel,
        repaymentFrequency: loan.repaymentFrequency ?? "Monthly",
        dueDate: d.toISOString().slice(0, 10),
        amount,
        offsetBalance,
        shortfall: offsetBalance < amount,
      });
    }
  }
  items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const dueTotal = items.reduce((s, i) => s + i.amount, 0);
  // Each loan's offset balance counts once toward "available", not once per occurrence — a
  // fortnightly loan due twice in a 30-day window still only has one offset account behind it.
  const loanIdsInWindow = new Set(items.map((i) => i.loanId));
  const availableTotal = loans.filter((l) => loanIdsInWindow.has(l.id)).reduce((s, l) => s + (l.offsetBalance ?? 0), 0);
  const shortfallTotal = Math.max(0, dueTotal - availableTotal);

  return { dueTotal, availableTotal, shortfallTotal, items };
}

export interface BufferDetailItem {
  id: string;
  label: string;
  scopeLabel: string;
  currentBalance: number;
  target?: number;
  targetMonths?: number;
  monthsCovered?: number;
  coveredPercent?: number;
}

export interface BufferDetailsSummary {
  totalRequired: number;
  totalAvailable: number;
  totalShortfall: number;
  items: BufferDetailItem[];
}

/** Per-buffer detail (target, current balance, months/percent covered) plus portfolio-wide
 * required/available/shortfall totals across every buffer — the expanded view behind the single
 * rolled-up percentage computeBufferStatus shows. Same "avg of the trailing 3 months' expenses in
 * scope" estimate as the dedicated Buffers page (see buffers.tsx's monthlyExpenseEstimate). */
export function computeBufferDetails(buffers: CashBuffer[], expenses: Expense[], assets: Asset[], entities: Entity[]): BufferDetailsSummary {
  const cutoffIso = addMonths(todayISO(), -3);

  const monthlyExpenseEstimate = (scopeType: CashBuffer["scopeType"], scopeId?: string) => {
    const relevant = expenses.filter((e) => {
      if (e.date < cutoffIso) return false;
      if (scopeType === "Portfolio") return true;
      if (scopeType === "Asset") return e.assetId === scopeId;
      if (scopeType === "Entity") return assets.find((a) => a.id === e.assetId)?.ownerEntityId === scopeId;
      return true;
    });
    return relevant.reduce((s, e) => s + e.cost, 0) / 3;
  };

  const items: BufferDetailItem[] = buffers.map((b) => {
    const monthlyExpense = monthlyExpenseEstimate(b.scopeType, b.scopeId);
    const monthsCovered = monthlyExpense > 0 ? b.currentBalance / monthlyExpense : undefined;
    const target = b.targetAmount ?? (b.targetMonths ? b.targetMonths * monthlyExpense : undefined);
    const coveredPercent = target && target > 0 ? Math.min(100, Math.round((b.currentBalance / target) * 100)) : undefined;
    const scopeLabel =
      b.scopeType === "Portfolio"
        ? "Whole portfolio"
        : b.scopeType === "Entity"
          ? (entities.find((e) => e.id === b.scopeId)?.name ?? "Entity")
          : (assets.find((a) => a.id === b.scopeId)?.name ?? "Asset");
    return { id: b.id, label: b.label, scopeLabel, currentBalance: b.currentBalance, target, targetMonths: b.targetMonths, monthsCovered, coveredPercent };
  });

  const totalRequired = items.reduce((s, i) => s + (i.target ?? 0), 0);
  const totalAvailable = items.reduce((s, i) => s + i.currentBalance, 0);
  const totalShortfall = Math.max(0, totalRequired - totalAvailable);

  return { totalRequired, totalAvailable, totalShortfall, items };
}

export interface OverviewAlert {
  id: string;
  label: string;
}

/** Rule-based (no AI) alerts: missing or soon-to-expire insurance for each property in scope. */
export function computeInsuranceAlerts(
  properties: Property[],
  policies: InsurancePolicy[],
): OverviewAlert[] {
  const today = todayISO();
  const alerts: OverviewAlert[] = [];
  const multi = properties.length > 1;
  for (const p of properties) {
    const propPolicies = policies.filter((ip) => ip.propertyId === p.id);
    const active = propPolicies.filter((ip) => !ip.coverEnd || ip.coverEnd >= today);
    const suffix = multi ? ` — ${p.alias || p.address}` : "";
    if (active.length === 0) {
      alerts.push({ id: `noins_${p.id}`, label: `No active insurance on file${suffix}` });
      continue;
    }
    for (const ip of active) {
      if (!ip.coverEnd) continue;
      const d = daysUntil(ip.coverEnd);
      if (d >= 0 && d <= 30) {
        alerts.push({
          id: `exp_${ip.id}`,
          label: `${ip.insurer} policy renews in ${d} day${d === 1 ? "" : "s"}${suffix}`,
        });
      }
    }
  }
  return alerts;
}

export interface RentHeatmapCell {
  year: number;
  month: number; // 0-11
  amount: number;
}

/** Rent received per calendar month for the trailing `yearsBack` years, for the "Rent received" heatmap. */
export function computeRentHeatmap(ledger: LedgerEntry[], yearsBack = 3): RentHeatmapCell[] {
  const now = new Date();
  const cells: RentHeatmapCell[] = [];
  for (let yOffset = yearsBack - 1; yOffset >= 0; yOffset--) {
    const year = now.getFullYear() - yOffset;
    for (let m = 0; m < 12; m++) cells.push({ year, month: m, amount: 0 });
  }
  const byKey = new Map(cells.map((c) => [`${c.year}-${c.month}`, c]));
  for (const e of ledger) {
    if (e.type !== "Rent Payment") continue;
    const d = new Date(e.date);
    const cell = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (cell) cell.amount += e.credit;
  }
  return cells;
}

export interface ValueDebtPoint {
  name: string;
  value: number;
  debt: number;
  projected: boolean;
}

const latestAtOrBefore = <T extends { date: string }>(rows: T[], dateISO: string): T | undefined =>
  rows.filter((r) => r.date <= dateISO).sort((a, b) => (a.date < b.date ? 1 : -1))[0];

/** Straight-line annual amortisation per loan at its own rate, used only for the 5Y/10Y projection —
 * a simplified stand-in for the full per-property forecast model on the Forecasts tab. */
function projectDebt(loans: Loan[], years: number): number[] {
  const perLoan = loans.map((l) => {
    const rate = (l.interestRate ?? 6) / 100;
    const annualPayment = (l.monthlyEmi || 0) * 12;
    const interestOnly = l.loanType === "Interest Only";
    const balances = [l.totalBalance || 0];
    let balance = l.totalBalance || 0;
    for (let y = 1; y <= years; y++) {
      const interest = balance * rate;
      const principal = interestOnly ? 0 : Math.max(annualPayment - interest, 0);
      balance = Math.max(balance - principal, 0);
      balances.push(balance);
    }
    return balances;
  });
  const total: number[] = [];
  for (let y = 0; y <= years; y++) total.push(perLoan.reduce((s, b) => s + b[y], 0));
  return total;
}

/** Portfolio value vs debt over time. 12M reads real valuation/loan-balance snapshots month by
 * month. 5Y/10Y shows the last two real year-end snapshots then projects forward (3% p.a. capital
 * growth, straight-line loan amortisation) — the projected points are flagged so the chart can
 * render them dashed. */
export function computeValueDebtTrend(
  properties: Property[],
  loans: Loan[],
  valuationSnapshots: ValuationSnapshot[],
  loanBalanceSnapshots: LoanBalanceSnapshot[],
  range: "12M" | "5Y" | "10Y",
): ValueDebtPoint[] {
  if (range === "12M") {
    const points: ValueDebtPoint[] = [];
    for (let i = 11; i >= 0; i--) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const value = properties.reduce((s, p) => {
        if (!p.assetId) return s;
        const snap = latestAtOrBefore(
          valuationSnapshots.filter((v) => v.assetId === p.assetId),
          monthEnd,
        );
        return s + (snap?.value ?? (i === 0 ? p.currentValue || 0 : 0));
      }, 0);
      const debt = loans.reduce((s, l) => {
        const snap = latestAtOrBefore(
          loanBalanceSnapshots.filter((v) => v.loanId === l.id),
          monthEnd,
        );
        return s + (snap?.balance ?? (i === 0 ? l.totalBalance || 0 : 0));
      }, 0);
      points.push({
        name: d.toLocaleString("en-AU", { month: "short" }),
        value,
        debt,
        projected: false,
      });
    }
    return points;
  }

  const years = range === "5Y" ? 5 : 10;
  const now = new Date();
  const points: ValueDebtPoint[] = [];

  for (let i = 2; i >= 0; i--) {
    const y = now.getFullYear() - i;
    const asOf = i === 0 ? todayISO() : `${y}-12-31`;
    const value =
      i === 0
        ? properties.reduce((s, p) => s + (p.currentValue || 0), 0)
        : properties.reduce((s, p) => {
            if (!p.assetId) return s;
            const snap = latestAtOrBefore(
              valuationSnapshots.filter((v) => v.assetId === p.assetId),
              asOf,
            );
            return s + (snap?.value ?? 0);
          }, 0);
    const debt =
      i === 0
        ? loans.reduce((s, l) => s + (l.totalBalance || 0), 0)
        : loans.reduce((s, l) => {
            const snap = latestAtOrBefore(
              loanBalanceSnapshots.filter((v) => v.loanId === l.id),
              asOf,
            );
            return s + (snap?.balance ?? 0);
          }, 0);
    points.push({ name: String(y), value, debt, projected: false });
  }

  const debtProjection = projectDebt(loans, years);
  const currentValue = properties.reduce((s, p) => s + (p.currentValue || 0), 0);
  for (let y = 1; y <= years; y++) {
    points.push({
      name: String(now.getFullYear() + y),
      value: currentValue * Math.pow(1.03, y),
      debt: debtProjection[y],
      projected: true,
    });
  }
  return points;
}
