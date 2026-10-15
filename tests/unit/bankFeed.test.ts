import { describe, expect, it } from "vitest";
import { buildFeedRows, summarizeStatement } from "@/lib/bankFeed";
import { feedTotals } from "@/lib/bankFeed";
import type { AiIntakeProposal, AppState, Expense, LedgerEntry, Tenant } from "@/lib/types";

type Tx = { date: string; description: string; amount: number; direction: "in" | "out" };

function statement(id: string, transactions: Tx[]): AiIntakeProposal {
  return {
    id,
    kind: "bank_statement",
    status: "pending",
    bankAccountId: "acct1",
    payload: { transactions },
  } as unknown as AiIntakeProposal;
}

const tenant = {
  id: "t1",
  name: "Jane Facer",
  propertyId: "p1",
  leaseStart: "2026-03-14",
  rentAmount: 1170,
  rentFrequency: "Weekly",
  paidUpToDate: "2026-09-25",
} as unknown as Tenant;

const rent = (date: string): Tx => ({
  date,
  description: "TRANSFER FROM J FACER RENT",
  amount: 1170,
  direction: "in",
});
const empty = { expenses: [] as Expense[], ledger: [] as LedgerEntry[] };

describe("compiled bank feed across overlapping statements", () => {
  const sep = statement("s1", [
    rent("2026-09-19"),
    rent("2026-09-26"),
    { date: "2026-09-27", description: "Coffee", amount: 5, direction: "out" },
  ]);
  // The October statement's extraction words the overlapping line differently — still the same line.
  const oct = statement("s2", [
    { ...rent("2026-09-26"), description: "TFR J FACER" },
    rent("2026-10-03"),
  ]);

  it("shows a transaction on both statements once", () => {
    const rows = buildFeedRows([sep, oct], empty);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-10-03",
      "2026-09-27",
      "2026-09-26",
      "2026-09-19",
    ]);
    expect(rows.find((r) => r.date === "2026-09-26")!.copies).toHaveLength(2);
  });

  it("keeps two genuine identical transactions on one statement", () => {
    const twice = statement("s3", [rent("2026-10-10"), rent("2026-10-10")]);
    expect(buildFeedRows([twice], empty)).toHaveLength(2);
  });

  it("counts a line recorded from the other statement as recorded, and flags one recorded twice", () => {
    const ledger = [
      {
        id: "l1",
        tenantId: "t1",
        date: "2026-09-26",
        type: "Rent Payment",
        credit: 1170,
        debit: 0,
        feedProposalId: "s1",
        feedLineIndex: 1,
      },
    ] as LedgerEntry[];
    const row = buildFeedRows([sep, oct], { expenses: [], ledger }).find(
      (r) => r.date === "2026-09-26",
    )!;
    expect(row.recorded).toBe(true);
    expect(row.ledgerEntryId).toBe("l1");
    expect(row.recordedCount).toBe(1);

    const both = [
      ...ledger,
      { ...ledger[0], id: "l2", feedProposalId: "s2", feedLineIndex: 0 },
    ] as LedgerEntry[];
    expect(
      buildFeedRows([sep, oct], { expenses: [], ledger: both }).find(
        (r) => r.date === "2026-09-26",
      )!.recordedCount,
    ).toBe(2);
  });

  it("summarizes a new statement: overlap already recorded isn't new, rent deposits are suggested", () => {
    const ledger = [
      {
        id: "l1",
        tenantId: "t1",
        date: "2026-09-26",
        type: "Rent Payment",
        credit: 1170,
        debit: 0,
        feedProposalId: "s1",
        feedLineIndex: 1,
      },
    ] as LedgerEntry[];
    const state = {
      aiProposals: [sep, oct],
      tenants: [tenant],
      providers: [],
      providerProperties: [],
      ledger,
      bills: [],
      expenses: [],
    } as unknown as AppState;
    expect(summarizeStatement(oct, state)).toEqual({
      total: 2,
      newCount: 1,
      rentSuggestions: 1,
      expenseFlags: 0,
    });
  });

  it("summary counts flagged expenses, and never counts an internal transfer as rent", () => {
    const st = statement("s4", [
      {
        date: "2026-10-05",
        description: "Funds transfer From linked account xx7814 - Internal transfer",
        amount: 2340,
        direction: "in",
      },
      { date: "2026-10-06", description: "BPAY COUNCIL RATES", amount: 480, direction: "out" },
      rent("2026-10-10"),
    ]);
    const state = {
      aiProposals: [st],
      tenants: [tenant],
      providers: [],
      providerProperties: [],
      ledger: [],
      bills: [],
      expenses: [],
    } as unknown as AppState;
    expect(summarizeStatement(st, state)).toEqual({
      total: 3,
      newCount: 3,
      rentSuggestions: 1,
      expenseFlags: 1,
    });
  });
});

describe("feedTotals (month subtotals in the compiled feed)", () => {
  it("sums money in and out, leaving informational loan reference lines out", () => {
    expect(
      feedTotals([
        { amount: 1170, direction: "credit", status: "feed_only" },
        { amount: 1170, direction: "credit", status: "recorded" },
        { amount: 480.1, direction: "debit", status: "feed_only" },
        { amount: 2000, direction: "debit", status: "reference" },
      ]),
    ).toEqual({ totalIn: 2340, totalOut: 480.1, net: 1859.9 });
  });

  it("is zero for no rows", () => {
    expect(feedTotals([])).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
  });
});
