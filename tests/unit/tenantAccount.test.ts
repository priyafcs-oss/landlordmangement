import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTenantLedger, paidUpToDetails } from "@/lib/calculations";
import type { LedgerEntry, Tenant, TenantInvoice } from "@/lib/types";

// The Rental hub treats a tenant as one plain debit/credit account: invoices are charges that
// ordinary rent transfers pay off (no "mark paid"), and "Owes" only counts what's due by today.

const tenant = {
  id: "t1",
  leaseStart: "2026-10-03", // Saturday; weekly cycles 03, 10, 17, 24 Oct
  paidUpToDate: "2026-10-02",
  rentAmount: 700,
  rentFrequency: "Weekly",
} as unknown as Tenant;

const pay = (date: string, credit: number) =>
  ({
    id: crypto.randomUUID(),
    tenantId: "t1",
    date,
    type: "Rent Payment",
    description: "",
    debit: 0,
    credit,
  }) as LedgerEntry;

const invoice = (amountDue: number, status: TenantInvoice["status"] = "Unpaid") =>
  ({
    id: "i1",
    tenantId: "t1",
    chargeType: "Other",
    amountDue,
    dateIssued: "2026-10-05",
    dueDate: "2026-10-19",
    status,
    description: "",
  }) as TenantInvoice;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 25, 12)); // 25 Oct 2026, local
});
afterEach(() => vi.useRealTimers());

describe("one-account tenant ledger", () => {
  it("an invoice paid inside rent transfers is settled and pulls the paid-up date back", () => {
    // 4 cycles = $2,800 rent + $140 invoice; paid $3,040 → $100 ahead (1 day = $100).
    const entries = [pay("2026-10-03", 1500), pay("2026-10-17", 1540)];
    const inv = [invoice(140)];
    expect(paidUpToDetails(tenant, entries, [], inv)).toEqual({ date: "2026-10-31", extra: 0 });
    const ledger = buildTenantLedger(tenant, entries, inv);
    expect(ledger.rows.find((r) => r.invoiceId)?.invoiceStatus).toBe("Paid");
    expect(ledger.outstandingInvoices).toBe(0);
    expect(ledger.overdue).toBe(0);
    expect(ledger.nextDue).toBe("2026-11-01");
  });

  it("ignores a stale stored invoice status — an invoice is always a charge", () => {
    const entries = [pay("2026-10-03", 2800)];
    const ledger = buildTenantLedger(tenant, [], [invoice(140, "Paid")]);
    expect(ledger.rows.find((r) => r.invoiceId)?.credit).toBe(0);
    expect(ledger.rows.find((r) => r.invoiceId)?.invoiceStatus).toBe("Unpaid");
    // Credits go to the oldest charge first: the 5 Oct invoice is covered before the 24 Oct rent.
    const paid = buildTenantLedger(tenant, entries, [invoice(140, "Unpaid")]);
    expect(paid.total).toBeCloseTo(140, 2);
    expect(paid.rows.find((r) => r.invoiceId)?.invoiceStatus).toBe("Paid");
  });

  it("paid up to a future date never shows as owing, even mid-cycle with a small closing balance", () => {
    // Current cycle 24 → 30 Oct; paid through 29 Oct + $50 → closing balance $50, but not overdue.
    const entries = [pay("2026-10-03", 2750)];
    const ledger = buildTenantLedger(tenant, entries, []);
    expect(paidUpToDetails(tenant, entries)).toEqual({ date: "2026-10-29", extra: 50 });
    expect(ledger.total).toBeCloseTo(50, 2);
    expect(ledger.overdue).toBe(0);
  });

  it("owes only the days up to today when behind", () => {
    // Paid to 22 Oct; 23–25 Oct = 3 days × $100 overdue.
    const ledger = buildTenantLedger(tenant, [pay("2026-10-03", 2000)], []);
    expect(ledger.overdue).toBeCloseTo(300, 2);
    expect(ledger.outstandingRent).toBeCloseTo(300, 2);
  });
});
