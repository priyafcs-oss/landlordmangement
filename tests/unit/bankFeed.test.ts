import { describe, expect, it } from "vitest";
import { buildFeedRows, summarizeStatement } from "@/lib/bankFeed";
import { isRentMultiple, suggestFeedLine } from "@/lib/feedSuggest";
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
    expect(summarizeStatement(oct, state)).toEqual({ total: 2, newCount: 1, rentSuggestions: 1 });
  });
});

describe("rent deposit suggestions", () => {
  const ctx = { tenants: [tenant], providers: [], providerProperties: [] };

  it("suggests rent when the description names the tenant and the amount is whole weeks", () => {
    expect(suggestFeedLine({ ...rent("2026-10-03") }, ctx)).toMatchObject({
      category: "Gross Rent",
      tenantId: "t1",
      propertyId: "p1",
    });
    expect(suggestFeedLine({ ...rent("2026-10-03"), amount: 2340 }, ctx)?.tenantId).toBe("t1");
  });

  it("doesn't suggest rent for a named payment that isn't a rent amount", () => {
    expect(suggestFeedLine({ ...rent("2026-10-03"), amount: 60.23 }, ctx)).toBeNull();
  });

  it("falls back to the one tenant whose rent fits when the description names nobody", () => {
    expect(
      suggestFeedLine(
        { date: "2026-10-03", description: "DEPOSIT 88213", amount: 1170, direction: "in" },
        ctx,
      )?.tenantId,
    ).toBe("t1");
  });

  it("isRentMultiple", () => {
    expect(isRentMultiple(3510, 1170)).toBe(true);
    expect(isRentMultiple(1100, 1170)).toBe(false);
  });
});
