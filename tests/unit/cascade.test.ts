import { describe, expect, it } from "vitest";
import {
  ASSET_CHILDREN,
  LOAN_CHILDREN,
  TENANT_CHILDREN,
  assetBufferIds,
  withoutChildren,
} from "@/lib/cascade";
import { TABLES } from "@/lib/db";
import type { AppState } from "@/lib/types";

const state = {
  ledger: [
    { id: "l1", tenantId: "t1" },
    { id: "l2", tenantId: "t2" },
  ],
  invoices: [{ id: "i1", tenantId: "t1" }],
  rentChanges: [],
  leaseHistory: [{ id: "h1", tenantId: "t1" }],
  loanBalanceSnapshots: [{ id: "s1", loanId: "loan1" }],
  loanStatements: [
    { id: "st1", loanId: "loan1" },
    { id: "st2", loanId: "loan2" },
  ],
  goldDetails: [{ id: "g1", assetId: "a1" }],
  etfDetails: [],
  depreciationItems: [{ id: "d1", assetId: "a1" }],
  valuationSnapshots: [{ id: "v1", assetId: "a1" }],
  expenses: [
    { id: "e1", assetId: "a1" },
    { id: "e2", propertyId: "p1" },
  ],
  bills: [{ id: "b1", assetId: "a1" }],
  buffers: [
    { id: "buf1", scopeType: "Asset", scopeId: "a1" },
    { id: "buf2", scopeType: "Portfolio" },
  ],
} as unknown as AppState;

describe("delete cascades (one list per parent, used by every delete path)", () => {
  it("removes a tenant's ledger, invoices and lease history only", () => {
    const s = withoutChildren(state, TENANT_CHILDREN, ["t1"]);
    expect(s.ledger.map((r) => r.id)).toEqual(["l2"]);
    expect(s.invoices).toEqual([]);
    expect(s.leaseHistory).toEqual([]);
    expect(s.loanStatements).toHaveLength(2);
  });

  it("removes a loan's snapshots and statements", () => {
    const s = withoutChildren(state, LOAN_CHILDREN, ["loan1"]);
    expect(s.loanBalanceSnapshots).toEqual([]);
    expect(s.loanStatements.map((r) => r.id)).toEqual(["st2"]);
  });

  // deleteProperty's own copy skipped an asset's bills/expenses/gold/ETF details and buffers.
  it("removes everything hanging off an asset, including its bills, expenses and buffers", () => {
    const s = withoutChildren(state, ASSET_CHILDREN, ["a1"]);
    for (const key of ["goldDetails", "depreciationItems", "valuationSnapshots", "bills"] as const)
      expect(s[key]).toEqual([]);
    expect(s.expenses.map((e) => e.id)).toEqual(["e2"]);
    expect(assetBufferIds(state, "a1")).toEqual(["buf1"]);
  });

  it("every child list points at a real table", () => {
    for (const c of [...TENANT_CHILDREN, ...LOAN_CHILDREN, ...ASSET_CHILDREN])
      expect(TABLES[c.key]).toBeTruthy();
  });
});
