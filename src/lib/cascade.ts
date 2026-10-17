import type { AppState } from "@/lib/types";

/** A kind of record that belongs to a parent and goes when the parent is deleted: the AppState /
 * TABLES key and the column holding the parent's id. */
export interface ChildRecords {
  key:
    | "ledger"
    | "invoices"
    | "rentChanges"
    | "leaseHistory"
    | "loanBalanceSnapshots"
    | "loanStatements"
    | "goldDetails"
    | "etfDetails"
    | "depreciationItems"
    | "valuationSnapshots"
    | "expenses"
    | "bills";
  column: string;
}

/**
 * What hangs off each parent — the ONE list, used by the parent's own delete (deleteTenant,
 * deleteLoan, deleteAsset) and by deleteProperty, which used to re-list them itself and missed an
 * asset's bills, expenses, gold/ETF details and buffers. Add a new child table here and every
 * delete path removes it.
 */
export const TENANT_CHILDREN: ChildRecords[] = [
  { key: "ledger", column: "tenantId" },
  { key: "invoices", column: "tenantId" },
  { key: "rentChanges", column: "tenantId" },
  { key: "leaseHistory", column: "tenantId" },
];
export const LOAN_CHILDREN: ChildRecords[] = [
  { key: "loanBalanceSnapshots", column: "loanId" },
  { key: "loanStatements", column: "loanId" },
];
/** Plus the asset's own cash buffers (scopeType "Asset") — see assetBufferIds. */
export const ASSET_CHILDREN: ChildRecords[] = [
  { key: "depreciationItems", column: "assetId" },
  { key: "valuationSnapshots", column: "assetId" },
  { key: "goldDetails", column: "assetId" },
  { key: "etfDetails", column: "assetId" },
  { key: "expenses", column: "assetId" },
  { key: "bills", column: "assetId" },
];

/** State with every child record of the given parents removed. */
export function withoutChildren(
  s: AppState,
  children: ChildRecords[],
  parentIds: string[],
): AppState {
  if (parentIds.length === 0) return s;
  const ids = new Set(parentIds);
  const next = { ...s } as Record<string, unknown>;
  for (const { key, column } of children) {
    next[key] = (s[key] as unknown as Record<string, unknown>[]).filter(
      (row) => !ids.has(row[column] as string),
    );
  }
  return next as unknown as AppState;
}

/** The cash buffers scoped to an asset. */
export function assetBufferIds(s: Pick<AppState, "buffers">, assetId: string): string[] {
  return s.buffers.filter((b) => b.scopeType === "Asset" && b.scopeId === assetId).map((b) => b.id);
}
