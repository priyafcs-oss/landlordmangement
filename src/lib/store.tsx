import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type {
  AppState,
  Property,
  Tenant,
  LedgerEntry,
  TenantInvoice,
  Loan,
  Expense,
  Inspection,
  RentChange,
  LeaseHistory,
  MaintenanceRequest,
  AiConfig,
  LandlordProfile,
  PropertyBill,
  AiIntakeProposal,
  EmailInboxLogEntry,
  ExpenseProposalPayload,
  LeaseTemplateConfig,
  Provider,
  Entity,
  ReportHistoryEntry,
  Asset,
  GoldDetails,
  EtfDetails,
  DepreciationItem,
  ValuationSnapshot,
  LoanBalanceSnapshot,
  CashBuffer,
} from "./types";
import {
  TABLES,
  selectAll,
  upsertRow,
  updateRow,
  deleteRow,
  deleteWhere,
  deleteWhereIn,
  loadSettings,
  saveSettings,
} from "./db";
import { paidUpToDateFromPayments, todayISO } from "./calculations";
import { toast } from "sonner";

const defaultAi: AiConfig = {
  enabled: true,
  dailyCount: 0,
  countDate: new Date().toISOString().slice(0, 10),
  dailyLimit: 10,
};

const defaultProfile: LandlordProfile = {
  fullName: "",
  email: "",
  phone: "",
  notifyEmail: true,
  notifySms: false,
};

/** Bumped only if AppState's shape changes in a way old cached data couldn't safely fill in for. */
const CACHE_KEY = "landlord-os-cache-v1";
/** Above this length a string is almost certainly base64 file/photo data, not real field content
 * (addresses, notes, descriptions) — stripped from the cached snapshot so a portfolio with a few
 * PDFs/photos doesn't blow past localStorage's ~5-10MB per-origin quota. The full value (including
 * every file) still arrives moments later from the real `refresh()` this cache only front-runs. */
const MAX_CACHED_STRING_LENGTH = 2000;

function stripLargeStrings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLargeStrings);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripLargeStrings(v);
    return out;
  }
  if (typeof value === "string" && value.length > MAX_CACHED_STRING_LENGTH) return undefined;
  return value;
}

/**
 * Instant-paint cache: every route waited on the same `Promise.all` of ~22 tables before anything
 * rendered, so even a page that only needs 3-4 of them (e.g. Rental Hub) sat behind the slowest
 * one. Reading last session's snapshot synchronously on mount lets the UI paint immediately with
 * "probably still correct" data while the real `refresh()` runs underneath and silently corrects
 * it — first-ever load (empty cache) is unchanged, but every load after that is instant.
 */
function loadCache(): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AppState) : null;
  } catch {
    return null;
  }
}

function saveCache(state: AppState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(stripLargeStrings(state)));
  } catch {
    // Quota exceeded or a serialization failure — caching is a pure optimization, never fatal.
  }
}

const empty: AppState = {
  properties: [],
  tenants: [],
  providers: [],
  entities: [],
  assets: [],
  goldDetails: [],
  etfDetails: [],
  depreciationItems: [],
  valuationSnapshots: [],
  loanBalanceSnapshots: [],
  buffers: [],
  ledger: [],
  invoices: [],
  loans: [],
  expenses: [],
  inspections: [],
  rentChanges: [],
  leaseHistory: [],
  maintenanceRequests: [],
  aiConfig: defaultAi,
  landlordProfile: defaultProfile,
  bills: [],
  aiProposals: [],
  emailInboxLog: [],
  leaseTemplate: null,
  tenantInfoStatement: null,
  reportHistory: [],
};

interface StoreCtx {
  state: AppState;
  loading: boolean;
  refresh: () => Promise<void>;
  set: (updater: (s: AppState) => AppState) => void;
  reset: () => void;

  addProperty: (p: Omit<Property, "id">) => string;
  updateProperty: (id: string, p: Partial<Property>) => void;
  deleteProperty: (id: string) => void;

  addTenant: (t: Omit<Tenant, "id" | "paidUpToDate"> & { paidUpToDate?: string }) => string;
  updateTenant: (id: string, t: Partial<Tenant>) => void;
  deleteTenant: (id: string) => void;

  renewLease: (
    tenantId: string,
    args: {
      newStart: string;
      newEnd?: string;
      newDuration?: Tenant["leaseDuration"];
      newRent: number;
      newFrequency?: Tenant["rentFrequency"];
      newLeaseDocumentFileName?: string;
      newLeaseDocumentFileData?: string;
    },
  ) => void;
  /** Ends a fixed-term lease (archiving it to history) and continues the tenancy periodically on the same terms. */
  convertToPeriodic: (tenantId: string) => void;

  addLedger: (e: Omit<LedgerEntry, "id">) => void;
  deleteLedger: (id: string) => void;

  addInvoice: (i: Omit<TenantInvoice, "id">) => void;
  updateInvoice: (id: string, i: Partial<TenantInvoice>) => void;
  deleteInvoice: (id: string) => void;

  addLoan: (l: Omit<Loan, "id">) => void;
  updateLoan: (id: string, l: Partial<Loan>) => void;
  deleteLoan: (id: string) => void;

  /** Returns the generated id synchronously (same pattern as findOrCreateEntity), so callers that
   * need to link a related row (e.g. a PropertyBill's linkedExpenseId) can use it immediately. */
  addExpense: (e: Omit<Expense, "id">) => string;
  updateExpense: (id: string, e: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;

  addInspection: (i: Omit<Inspection, "id">) => void;
  updateInspection: (id: string, i: Partial<Inspection>) => void;
  deleteInspection: (id: string) => void;

  addRentChange: (r: Omit<RentChange, "id">) => void;
  updateRentChange: (id: string, r: Partial<RentChange>) => void;
  deleteRentChange: (id: string) => void;
  addLeaseHistory: (h: Omit<LeaseHistory, "id">) => void;
  updateLeaseHistory: (id: string, h: Partial<LeaseHistory>) => void;
  deleteLeaseHistory: (id: string) => void;

  addProvider: (p: Omit<Provider, "id">) => void;
  updateProvider: (id: string, p: Partial<Provider>) => void;
  deleteProvider: (id: string) => void;

  addEntity: (e: Omit<Entity, "id">) => void;
  updateEntity: (id: string, e: Partial<Entity>) => void;
  deleteEntity: (id: string) => void;
  /** Case-insensitive name match against existing entities; creates one if none matches. Returns
   * synchronously (the id is generated locally before the fire-and-forget DB write), so callers
   * can use the result immediately — e.g. as a new property's entityId in the same save. */
  findOrCreateEntity: (name: string, type: Entity["type"]) => string;

  /** Generic asset CRUD — used for Gold/ETF (and anything added later). Property manages its own
   * mirrored asset row automatically via addProperty/updateProperty/deleteProperty. */
  addAsset: (
    a: Omit<Asset, "id">,
    details?: { goldDetails?: Omit<GoldDetails, "assetId">; etfDetails?: Omit<EtfDetails, "assetId"> },
  ) => void;
  updateAsset: (
    id: string,
    a: Partial<Asset>,
    details?: { goldDetails?: Partial<GoldDetails>; etfDetails?: Partial<EtfDetails> },
  ) => void;
  deleteAsset: (id: string) => void;

  addDepreciationItem: (d: Omit<DepreciationItem, "id">) => void;
  updateDepreciationItem: (id: string, d: Partial<DepreciationItem>) => void;
  deleteDepreciationItem: (id: string) => void;

  addBuffer: (b: Omit<CashBuffer, "id">) => void;
  updateBuffer: (id: string, b: Partial<CashBuffer>) => void;
  deleteBuffer: (id: string) => void;

  addMaintenanceRequest: (m: Omit<MaintenanceRequest, "id" | "createdAt" | "status">) => Promise<void>;
  updateMaintenanceRequest: (id: string, m: Partial<MaintenanceRequest>) => void;
  deleteMaintenanceRequest: (id: string) => void;

  updateLandlordProfile: (p: Partial<LandlordProfile>) => void;
  updateLeaseTemplate: (t: LeaseTemplateConfig | null) => void;
  addReportHistoryEntry: (entry: ReportHistoryEntry) => void;
  updateTenantInfoStatement: (t: AppState["tenantInfoStatement"]) => void;

  addBill: (b: Omit<PropertyBill, "id">) => void;
  updateBill: (id: string, b: Partial<PropertyBill>) => void;
  deleteBill: (id: string) => void;
  /** paidDate defaults to today — Phase 2 accrual-matching passes the payment evidence's own
   * date (a statement/bank-transaction date) so P&L lands in the right period. */
  markBillPaid: (id: string, opts?: { paidDate?: string }) => void;

  dismissProposal: (id: string) => void;
  markProposalApplied: (id: string) => void;
  updateProposal: (id: string, patch: Partial<AiIntakeProposal>) => void;
  /** Stages a manually-entered transaction flagged by a client-side duplicate/price-spike check
   * (see AddTransactionDialog) — the only proposal kind created client-side rather than by an
   * edge function, since it's a plain data-entry check, not AI extraction. */
  addExpenseProposal: (p: {
    propertyId?: string;
    reviewReason: string;
    payload: ExpenseProposalPayload;
    sourceFileName?: string;
    sourceFileData?: string;
  }) => void;

  setAiEnabled: (v: boolean) => void;
  consumeAiBudget: () => { ok: boolean; reason?: string };
  resetAiUsage: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

const uid = (p: string) => p + "_" + Math.random().toString(36).slice(2, 10);

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Persists a point-in-time value snapshot — called whenever an asset's currentValue or a
 * loan's balance changes, so the Dashboard's trend charts build real history forward from today. */
function snapshotValuation(assetId: string, value: number): ValuationSnapshot {
  const row: ValuationSnapshot = { id: uid("val"), assetId, date: todayISO(), value };
  void upsertRow(TABLES.valuationSnapshots, row as unknown as Record<string, unknown>);
  return row;
}
function snapshotLoanBalance(loanId: string, balance: number): LoanBalanceSnapshot {
  const row: LoanBalanceSnapshot = { id: uid("lbal"), loanId, date: todayISO(), balance };
  void upsertRow(TABLES.loanBalanceSnapshots, row as unknown as Record<string, unknown>);
  return row;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => loadCache() ?? empty);
  const [loading, setLoading] = useState(() => loadCache() === null);

  const refresh = async () => {
    try {
      const [
        properties,
        tenants,
        providers,
        entities,
        assets,
        goldDetails,
        etfDetails,
        depreciationItems,
        valuationSnapshots,
        loanBalanceSnapshots,
        buffers,
        ledger,
        invoices,
        loans,
        expenses,
        inspections,
        rentChanges,
        leaseHistory,
        maintenanceRequests,
        bills,
        aiProposals,
        emailInboxLog,
        settings,
      ] = await Promise.all([
        selectAll<Property>(TABLES.properties),
        selectAll<Tenant>(TABLES.tenants),
        selectAll<Provider>(TABLES.providers),
        selectAll<Entity>(TABLES.entities),
        selectAll<Asset>(TABLES.assets),
        selectAll<GoldDetails>(TABLES.goldDetails),
        selectAll<EtfDetails>(TABLES.etfDetails),
        selectAll<DepreciationItem>(TABLES.depreciationItems),
        selectAll<ValuationSnapshot>(TABLES.valuationSnapshots),
        selectAll<LoanBalanceSnapshot>(TABLES.loanBalanceSnapshots),
        selectAll<CashBuffer>(TABLES.buffers),
        selectAll<LedgerEntry>(TABLES.ledger),
        selectAll<TenantInvoice>(TABLES.invoices),
        selectAll<Loan>(TABLES.loans),
        selectAll<Expense>(TABLES.expenses),
        selectAll<Inspection>(TABLES.inspections),
        selectAll<RentChange>(TABLES.rentChanges),
        selectAll<LeaseHistory>(TABLES.leaseHistory),
        selectAll<MaintenanceRequest>(TABLES.maintenanceRequests),
        selectAll<PropertyBill>(TABLES.bills),
        selectAll<AiIntakeProposal>(TABLES.aiProposals),
        selectAll<EmailInboxLogEntry>(TABLES.emailInboxLog),
        loadSettings(),
      ]);
      // Units predating PropertyUnit.id (added for dwelling-scoped tenancies/expenses) load with
      // no id — backfilled here AND written straight back to the DB so every consumer always sees
      // the same stable id across reloads. Previously this backfill only lived in memory until the
      // property was next manually re-saved, so a unitId picked on a bill/expense/tenant one
      // session (e.g. "Granny flat" on a house + granny flat property) could silently stop
      // matching after the next reload generated a fresh random id for the same unit.
      const propertiesWithUnitIds = properties.map((p) => {
        if (!p.units || p.units.length === 0) return p;
        let changed = false;
        const units = p.units.map((u) => {
          if (u.id) return u;
          changed = true;
          return { ...u, id: uid("unit") };
        });
        if (changed) void updateRow(TABLES.properties, p.id, { units });
        return changed ? { ...p, units } : p;
      });
      const next: AppState = {
        properties: propertiesWithUnitIds,
        tenants,
        providers,
        entities,
        assets,
        goldDetails,
        etfDetails,
        depreciationItems,
        valuationSnapshots,
        loanBalanceSnapshots,
        buffers,
        ledger,
        invoices,
        loans,
        expenses,
        inspections,
        rentChanges,
        leaseHistory,
        maintenanceRequests,
        bills,
        aiProposals,
        emailInboxLog,
        aiConfig: { ...defaultAi, ...((settings?.aiConfig as AiConfig) ?? {}) },
        landlordProfile: { ...defaultProfile, ...((settings?.landlordProfile as LandlordProfile) ?? {}) },
        leaseTemplate: (settings?.leaseTemplate as LeaseTemplateConfig | undefined) ?? null,
        tenantInfoStatement:
          (settings?.tenantInfoStatement as AppState["tenantInfoStatement"] | undefined) ?? null,
        reportHistory: (settings?.reportHistory as ReportHistoryEntry[] | undefined) ?? [],
      };
      setState(next);
      saveCache(next);
    } catch (e) {
      // selectAll swallows per-table errors and returns [], so this only fires on something more
      // fundamental (network down, Supabase misconfigured) — surfaced here since a silent failure
      // previously just left the UI on stale/empty cached data with no indication anything was wrong.
      console.error("[cloud] refresh failed", e);
      toast.error("Couldn't load the latest data — check your connection and reload.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set: StoreCtx["set"] = (updater) => setState((s) => updater(s));

  /**
   * Single source of truth for `paidUpToDate`: always re-derived from the lease
   * start date plus every Rent Payment credit in the ledger, then persisted.
   */
  const recomputePaidUp = (
    tenantId: string,
    tenants: Tenant[],
    ledger: LedgerEntry[],
    rentChanges: RentChange[],
  ): Tenant[] =>
    tenants.map((t) => {
      if (t.id !== tenantId) return t;
      const next = paidUpToDateFromPayments(t, ledger, rentChanges);
      if (next === t.paidUpToDate) return t;
      void updateRow(TABLES.tenants, t.id, { paidUpToDate: next });
      return { ...t, paidUpToDate: next };
    });

  const value: StoreCtx = {
    state,
    loading,
    refresh,
    set,
    reset: () => void 0,

    addProperty: (p) => {
      const propertyId = uid("p");
      const assetId = uid("asset");
      const row: Property = { ...p, id: propertyId, assetId };
      void upsertRow(TABLES.properties, row as unknown as Record<string, unknown>);
      // Every property gets a mirrored row in the generic assets register — `properties` stays
      // the source of truth for its own fields, this mirror is just what makes Property show up
      // in the cross-asset-type Assets/Transactions/Bills/Loans views alongside Gold/ETF.
      const assetRow: Asset = {
        id: assetId,
        assetType: "Property",
        name: row.alias || row.address,
        purchaseDate: row.purchaseDate,
        purchaseCost: row.purchasePrice,
        currentValue: row.currentValue,
        status: "Active",
        linkedPropertyId: propertyId,
      };
      void upsertRow(TABLES.assets, assetRow as unknown as Record<string, unknown>);
      const snap = snapshotValuation(assetId, assetRow.currentValue);
      set((s) => ({
        ...s,
        properties: [...s.properties, row],
        assets: [...s.assets, assetRow],
        valuationSnapshots: [...s.valuationSnapshots, snap],
      }));
      return propertyId;
    },
    updateProperty: (id, p) => {
      void updateRow(TABLES.properties, id, p as Record<string, unknown>);
      set((s) => {
        const existing = s.properties.find((x) => x.id === id);
        let assets = s.assets;
        let valuationSnapshots = s.valuationSnapshots;
        let assetIdPatch: Partial<Property> = {};
        const touchesMirroredFields =
          p.alias !== undefined ||
          p.address !== undefined ||
          p.purchaseDate !== undefined ||
          p.purchasePrice !== undefined ||
          p.currentValue !== undefined;
        if (existing && !existing.assetId) {
          // A property that predates the Property<->Asset mirror (or whose mirror creation
          // failed) never gets an Asset row from the branch below, since that only ever updates
          // an existing mirror — it silently stays invisible on the Assets page forever. Create
          // the missing mirror now, the same shape addProperty gives a brand-new property.
          const updated = { ...existing, ...p };
          const assetId = uid("asset");
          const assetRow: Asset = {
            id: assetId,
            assetType: "Property",
            name: updated.alias || updated.address,
            purchaseDate: updated.purchaseDate,
            purchaseCost: updated.purchasePrice,
            currentValue: updated.currentValue,
            status: "Active",
            linkedPropertyId: id,
          };
          void upsertRow(TABLES.assets, assetRow as unknown as Record<string, unknown>);
          void updateRow(TABLES.properties, id, { assetId });
          assets = [...assets, assetRow];
          assetIdPatch = { assetId };
          valuationSnapshots = [...valuationSnapshots, snapshotValuation(assetId, assetRow.currentValue)];
        } else if (existing?.assetId && touchesMirroredFields) {
          const updated = { ...existing, ...p };
          const assetPatch: Partial<Asset> = {
            name: updated.alias || updated.address,
            purchaseDate: updated.purchaseDate,
            purchaseCost: updated.purchasePrice,
            currentValue: updated.currentValue,
          };
          void updateRow(TABLES.assets, existing.assetId, assetPatch as Record<string, unknown>);
          assets = s.assets.map((a) => (a.id === existing.assetId ? { ...a, ...assetPatch } : a));
          if (p.currentValue !== undefined) {
            valuationSnapshots = [...valuationSnapshots, snapshotValuation(existing.assetId, p.currentValue)];
          }
        }
        const properties = s.properties.map((x) => (x.id === id ? { ...x, ...p, ...assetIdPatch } : x));
        return { ...s, properties, assets, valuationSnapshots };
      });
    },
    deleteProperty: (id) => {
      const tenantIds = state.tenants.filter((t) => t.propertyId === id).map((t) => t.id);
      const assetId = state.properties.find((x) => x.id === id)?.assetId;
      void deleteRow(TABLES.properties, id);
      if (assetId) void deleteRow(TABLES.assets, assetId);
      void deleteWhere(TABLES.tenants, "propertyId", id);
      void deleteWhere(TABLES.loans, "propertyId", id);
      void deleteWhere(TABLES.expenses, "propertyId", id);
      void deleteWhere(TABLES.inspections, "propertyId", id);
      void deleteWhere(TABLES.bills, "propertyId", id);
      void deleteWhere(TABLES.providers, "propertyId", id);
      if (assetId) void deleteWhere(TABLES.depreciationItems, "assetId", assetId);
      void deleteWhereIn(TABLES.ledger, "tenantId", tenantIds);
      void deleteWhereIn(TABLES.invoices, "tenantId", tenantIds);
      set((s) => ({
        ...s,
        properties: s.properties.filter((x) => x.id !== id),
        assets: s.assets.filter((a) => a.id !== assetId),
        depreciationItems: s.depreciationItems.filter((d) => d.assetId !== assetId),
        tenants: s.tenants.filter((t) => t.propertyId !== id),
        loans: s.loans.filter((l) => l.propertyId !== id),
        expenses: s.expenses.filter((e) => e.propertyId !== id),
        inspections: s.inspections.filter((i) => i.propertyId !== id),
        bills: s.bills.filter((b) => b.propertyId !== id),
        providers: s.providers.filter((p) => p.propertyId !== id),
        ledger: s.ledger.filter((e) => !tenantIds.includes(e.tenantId)),
        invoices: s.invoices.filter((i) => !tenantIds.includes(i.tenantId)),
      }));
    },

    addTenant: (t) => {
      // Paid-up default = one day BEFORE lease start (so day 1 of lease reads as first due day)
      let defaultPaidUp = new Date().toISOString().slice(0, 10);
      if (t.leaseStart) {
        const d = new Date(t.leaseStart);
        d.setDate(d.getDate() - 1);
        defaultPaidUp = d.toISOString().slice(0, 10);
      }
      const row: Tenant = { ...t, paidUpToDate: t.paidUpToDate || defaultPaidUp, id: uid("t") };
      void upsertRow(TABLES.tenants, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, tenants: [...s.tenants, row] }));
      return row.id;
    },
    updateTenant: (id, patch) =>
      set((s) => {
        const prev = s.tenants.find((x) => x.id === id);
        void updateRow(TABLES.tenants, id, patch as Record<string, unknown>);
        let nextTenants = s.tenants.map((x) => (x.id === id ? { ...x, ...patch } : x));
        let rentChanges = s.rentChanges;
        if (prev && patch.rentAmount !== undefined && patch.rentAmount !== prev.rentAmount) {
          const rc: RentChange = {
            id: uid("rc"),
            tenantId: id,
            // The landlord-chosen effective date (IncreaseRentDialog always sets this alongside
            // rentAmount) — not "today", which silently backdated every increase to whenever it
            // happened to be clicked rather than the date it was meant to take effect.
            changeDate: patch.lastRentIncreaseDate ?? new Date().toISOString().slice(0, 10),
            oldRent: prev.rentAmount,
            newRent: patch.rentAmount,
          };
          void upsertRow(TABLES.rentChanges, rc as unknown as Record<string, unknown>);
          rentChanges = [...rentChanges, rc];
        }
        // Structural change → re-derive paid-up date from the ledger.
        if (
          patch.leaseStart !== undefined ||
          patch.rentAmount !== undefined ||
          patch.rentFrequency !== undefined
        ) {
          nextTenants = recomputePaidUp(id, nextTenants, s.ledger, rentChanges);
        }
        return { ...s, tenants: nextTenants, rentChanges };
      }),
    deleteTenant: (id) => {
      void deleteRow(TABLES.tenants, id);
      void deleteWhere(TABLES.ledger, "tenantId", id);
      void deleteWhere(TABLES.invoices, "tenantId", id);
      void deleteWhere(TABLES.rentChanges, "tenantId", id);
      void deleteWhere(TABLES.leaseHistory, "tenantId", id);
      set((s) => ({
        ...s,
        tenants: s.tenants.filter((x) => x.id !== id),
        ledger: s.ledger.filter((e) => e.tenantId !== id),
        invoices: s.invoices.filter((i) => i.tenantId !== id),
        rentChanges: s.rentChanges.filter((r) => r.tenantId !== id),
        leaseHistory: s.leaseHistory.filter((r) => r.tenantId !== id),
      }));
    },

    renewLease: (tenantId, args) =>
      set((s) => {
        const prev = s.tenants.find((t) => t.id === tenantId);
        if (!prev) return s;
        const originalStart =
          s.leaseHistory.find((h) => h.tenantId === tenantId)?.originalStartDate ?? prev.leaseStart ?? args.newStart;
        const history: LeaseHistory = {
          id: uid("lh"),
          tenantId,
          originalStartDate: originalStart,
          pastStartDate: prev.leaseStart ?? args.newStart,
          pastEndDate: prev.leaseExpiry ?? "",
          pastRent: prev.rentAmount,
          pastFrequency: prev.rentFrequency,
          // Archive whichever lease document was active during this past lease, so a
          // newly uploaded renewal document doesn't overwrite/lose the original.
          leaseDocumentFileName: prev.leaseDocumentFileName,
          leaseDocumentFileData: prev.leaseDocumentFileData,
        };
        void upsertRow(TABLES.leaseHistory, history as unknown as Record<string, unknown>);

        let rentChanges = s.rentChanges;
        if (args.newRent !== prev.rentAmount) {
          const rc: RentChange = {
            id: uid("rc"),
            tenantId,
            // The new rent takes effect from the new lease term's start date, not from whenever
            // the landlord happens to process the renewal in the app.
            changeDate: args.newStart,
            oldRent: prev.rentAmount,
            newRent: args.newRent,
          };
          void upsertRow(TABLES.rentChanges, rc as unknown as Record<string, unknown>);
          rentChanges = [...rentChanges, rc];
        }

        const patch: Partial<Tenant> = {
          leaseStart: args.newStart,
          leaseExpiry: args.newEnd || undefined,
          leaseDuration: args.newDuration ?? prev.leaseDuration,
          rentAmount: args.newRent,
          rentFrequency: args.newFrequency ?? prev.rentFrequency,
          lastRentIncreaseDate: args.newRent !== prev.rentAmount ? args.newStart : prev.lastRentIncreaseDate,
          // Only replace the current lease document if a new one was uploaded at renewal.
          ...(args.newLeaseDocumentFileData
            ? {
                leaseDocumentFileName: args.newLeaseDocumentFileName,
                leaseDocumentFileData: args.newLeaseDocumentFileData,
              }
            : {}),
        };
        void updateRow(TABLES.tenants, tenantId, { ...patch, leaseExpiry: args.newEnd || null });

        const tenants = recomputePaidUp(
          tenantId,
          s.tenants.map((t) => (t.id === tenantId ? { ...t, ...patch } : t)),
          s.ledger,
          rentChanges,
        );
        return { ...s, leaseHistory: [...s.leaseHistory, history], rentChanges, tenants };
      }),

    convertToPeriodic: (tenantId) =>
      set((s) => {
        const prev = s.tenants.find((t) => t.id === tenantId);
        if (!prev) return s;
        const originalStart =
          s.leaseHistory.find((h) => h.tenantId === tenantId)?.originalStartDate ?? prev.leaseStart ?? "";
        const history: LeaseHistory = {
          id: uid("lh"),
          tenantId,
          originalStartDate: originalStart,
          pastStartDate: prev.leaseStart ?? "",
          pastEndDate: prev.leaseExpiry ?? "",
          pastRent: prev.rentAmount,
          pastFrequency: prev.rentFrequency,
          leaseDocumentFileName: prev.leaseDocumentFileName,
          leaseDocumentFileData: prev.leaseDocumentFileData,
        };
        void upsertRow(TABLES.leaseHistory, history as unknown as Record<string, unknown>);
        // leaseStart and rentAmount are left untouched — the tenancy continues uninterrupted on
        // the same terms, it just no longer has a fixed end date.
        void updateRow(TABLES.tenants, tenantId, { leaseDuration: "Periodic", leaseExpiry: null });
        const tenants = s.tenants.map((t) =>
          t.id === tenantId ? { ...t, leaseDuration: "Periodic" as const, leaseExpiry: undefined } : t,
        );
        return { ...s, leaseHistory: [...s.leaseHistory, history], tenants };
      }),

    addLedger: (e) =>
      set((s) => {
        const row: LedgerEntry = { ...e, id: uid("le") };
        void upsertRow(TABLES.ledger, row as unknown as Record<string, unknown>);
        const ledger = [...s.ledger, row];
        return { ...s, ledger, tenants: recomputePaidUp(row.tenantId, s.tenants, ledger, s.rentChanges) };
      }),
    deleteLedger: (id) =>
      set((s) => {
        const entry = s.ledger.find((e) => e.id === id);
        void deleteRow(TABLES.ledger, id);
        const ledger = s.ledger.filter((e) => e.id !== id);
        return {
          ...s,
          ledger,
          tenants: entry ? recomputePaidUp(entry.tenantId, s.tenants, ledger, s.rentChanges) : s.tenants,
        };
      }),

    addInvoice: (i) => {
      const row: TenantInvoice = { ...i, id: uid("inv") };
      void upsertRow(TABLES.invoices, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, invoices: [...s.invoices, row] }));
    },
    updateInvoice: (id, i) => {
      void updateRow(TABLES.invoices, id, i as Record<string, unknown>);
      set((s) => ({ ...s, invoices: s.invoices.map((x) => (x.id === id ? { ...x, ...i } : x)) }));
    },
    deleteInvoice: (id) => {
      void deleteRow(TABLES.invoices, id);
      set((s) => ({ ...s, invoices: s.invoices.filter((x) => x.id !== id) }));
    },

    addLoan: (l) => {
      const row: Loan = { ...l, id: uid("l") };
      void upsertRow(TABLES.loans, row as unknown as Record<string, unknown>);
      const snap = snapshotLoanBalance(row.id, row.totalBalance);
      set((s) => ({ ...s, loans: [...s.loans, row], loanBalanceSnapshots: [...s.loanBalanceSnapshots, snap] }));
    },
    updateLoan: (id, l) => {
      void updateRow(TABLES.loans, id, l as Record<string, unknown>);
      set((s) => {
        const loans = s.loans.map((x) => (x.id === id ? { ...x, ...l } : x));
        let loanBalanceSnapshots = s.loanBalanceSnapshots;
        if (l.totalBalance !== undefined) {
          loanBalanceSnapshots = [...loanBalanceSnapshots, snapshotLoanBalance(id, l.totalBalance)];
        }
        return { ...s, loans, loanBalanceSnapshots };
      });
    },
    deleteLoan: (id) => {
      void deleteRow(TABLES.loans, id);
      set((s) => ({ ...s, loans: s.loans.filter((x) => x.id !== id) }));
    },

    addExpense: (e) => {
      const row: Expense = { ...e, id: uid("ex") };
      void upsertRow(TABLES.expenses, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, expenses: [...s.expenses, row] }));
      return row.id;
    },
    updateExpense: (id, e) => {
      void updateRow(TABLES.expenses, id, e as Record<string, unknown>);
      set((s) => ({ ...s, expenses: s.expenses.map((x) => (x.id === id ? { ...x, ...e } : x)) }));
    },
    deleteExpense: (id) => {
      void deleteRow(TABLES.expenses, id);
      set((s) => ({ ...s, expenses: s.expenses.filter((x) => x.id !== id) }));
    },

    addInspection: (i) => {
      const row: Inspection = { ...i, id: uid("ins") };
      void upsertRow(TABLES.inspections, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, inspections: [...s.inspections, row] }));
    },
    updateInspection: (id, i) => {
      void updateRow(TABLES.inspections, id, i as Record<string, unknown>);
      set((s) => ({ ...s, inspections: s.inspections.map((x) => (x.id === id ? { ...x, ...i } : x)) }));
    },
    deleteInspection: (id) => {
      void deleteRow(TABLES.inspections, id);
      set((s) => ({ ...s, inspections: s.inspections.filter((x) => x.id !== id) }));
    },

    addRentChange: (r) => {
      const row: RentChange = { ...r, id: uid("rc") };
      void upsertRow(TABLES.rentChanges, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, rentChanges: [...s.rentChanges, row] }));
    },
    updateRentChange: (id, patch) => {
      void updateRow(TABLES.rentChanges, id, patch as Record<string, unknown>);
      set((s) => {
        const rentChanges = s.rentChanges.map((r) => (r.id === id ? { ...r, ...patch } : r));
        const changed = rentChanges.find((r) => r.id === id);
        const tenants = changed
          ? recomputePaidUp(changed.tenantId, s.tenants, s.ledger, rentChanges)
          : s.tenants;
        return { ...s, rentChanges, tenants };
      });
    },
    deleteRentChange: (id) => {
      void deleteRow(TABLES.rentChanges, id);
      set((s) => {
        const removed = s.rentChanges.find((r) => r.id === id);
        const rentChanges = s.rentChanges.filter((r) => r.id !== id);
        const tenants = removed
          ? recomputePaidUp(removed.tenantId, s.tenants, s.ledger, rentChanges)
          : s.tenants;
        return { ...s, rentChanges, tenants };
      });
    },
    addLeaseHistory: (h) => {
      const row: LeaseHistory = { ...h, id: uid("lh") };
      void upsertRow(TABLES.leaseHistory, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, leaseHistory: [...s.leaseHistory, row] }));
    },
    updateLeaseHistory: (id, patch) => {
      void updateRow(TABLES.leaseHistory, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, leaseHistory: s.leaseHistory.map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
    },
    deleteLeaseHistory: (id) => {
      void deleteRow(TABLES.leaseHistory, id);
      set((s) => ({ ...s, leaseHistory: s.leaseHistory.filter((h) => h.id !== id) }));
    },

    addProvider: (p) => {
      const row: Provider = { ...p, id: uid("prov") };
      void upsertRow(TABLES.providers, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, providers: [...s.providers, row] }));
    },
    updateProvider: (id, patch) => {
      void updateRow(TABLES.providers, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },
    deleteProvider: (id) => {
      void deleteRow(TABLES.providers, id);
      set((s) => ({ ...s, providers: s.providers.filter((p) => p.id !== id) }));
    },

    addEntity: (e) => {
      const row: Entity = { ...e, id: uid("ent") };
      void upsertRow(TABLES.entities, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, entities: [...s.entities, row] }));
    },
    updateEntity: (id, patch) => {
      void updateRow(TABLES.entities, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, entities: s.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    },
    deleteEntity: (id) => {
      const linkedPropertyIds = state.properties.filter((p) => p.entityId === id).map((p) => p.id);
      void deleteRow(TABLES.entities, id);
      linkedPropertyIds.forEach((pid) => void updateRow(TABLES.properties, pid, { entityId: null }));
      set((s) => ({
        ...s,
        entities: s.entities.filter((e) => e.id !== id),
        properties: s.properties.map((p) => (p.entityId === id ? { ...p, entityId: undefined } : p)),
      }));
    },
    findOrCreateEntity: (name, type) => {
      const trimmed = name.trim();
      const existing = state.entities.find((e) => e.name.trim().toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing.id;

      // A "Joint" owner name is usually two people joined by "&"/"and" — split into even-share owners.
      const owners =
        type === "Joint"
          ? trimmed
              .split(/\s*(?:&|\band\b)\s*/i)
              .map((n) => n.trim())
              .filter(Boolean)
              .map((n) => ({ name: n, percent: 100 / Math.max(1, trimmed.split(/\s*(?:&|\band\b)\s*/i).filter(Boolean).length) }))
          : [{ name: trimmed, percent: 100 }];

      const row: Entity = { id: uid("ent"), name: trimmed, type, owners };
      void upsertRow(TABLES.entities, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, entities: [...s.entities, row] }));
      return row.id;
    },

    addAsset: (a, details) => {
      const row: Asset = { ...a, id: uid("asset") };
      void upsertRow(TABLES.assets, row as unknown as Record<string, unknown>);
      let goldRow: GoldDetails | undefined;
      let etfRow: EtfDetails | undefined;
      if (details?.goldDetails) {
        goldRow = { ...details.goldDetails, assetId: row.id };
        void upsertRow(TABLES.goldDetails, goldRow as unknown as Record<string, unknown>);
      }
      if (details?.etfDetails) {
        etfRow = { ...details.etfDetails, assetId: row.id };
        void upsertRow(TABLES.etfDetails, etfRow as unknown as Record<string, unknown>);
      }
      const snap = snapshotValuation(row.id, row.currentValue);
      set((s) => ({
        ...s,
        assets: [...s.assets, row],
        goldDetails: goldRow ? [...s.goldDetails, goldRow] : s.goldDetails,
        etfDetails: etfRow ? [...s.etfDetails, etfRow] : s.etfDetails,
        valuationSnapshots: [...s.valuationSnapshots, snap],
      }));
    },
    updateAsset: (id, patch, details) => {
      void updateRow(TABLES.assets, id, patch as Record<string, unknown>);
      if (details?.goldDetails) {
        void upsertRow(TABLES.goldDetails, { assetId: id, ...details.goldDetails } as unknown as Record<string, unknown>);
      }
      if (details?.etfDetails) {
        void upsertRow(TABLES.etfDetails, { assetId: id, ...details.etfDetails } as unknown as Record<string, unknown>);
      }
      set((s) => ({
        ...s,
        assets: s.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        goldDetails: details?.goldDetails
          ? s.goldDetails.some((g) => g.assetId === id)
            ? s.goldDetails.map((g) => (g.assetId === id ? { ...g, ...details.goldDetails } : g))
            : [...s.goldDetails, { assetId: id, ...details.goldDetails } as GoldDetails]
          : s.goldDetails,
        etfDetails: details?.etfDetails
          ? s.etfDetails.some((e) => e.assetId === id)
            ? s.etfDetails.map((e) => (e.assetId === id ? { ...e, ...details.etfDetails } : e))
            : [...s.etfDetails, { assetId: id, ...details.etfDetails } as EtfDetails]
          : s.etfDetails,
        valuationSnapshots:
          patch.currentValue !== undefined
            ? [...s.valuationSnapshots, snapshotValuation(id, patch.currentValue)]
            : s.valuationSnapshots,
      }));
    },
    deleteAsset: (id) => {
      void deleteRow(TABLES.assets, id);
      void deleteWhere(TABLES.depreciationItems, "assetId", id);
      set((s) => ({
        ...s,
        assets: s.assets.filter((a) => a.id !== id),
        goldDetails: s.goldDetails.filter((g) => g.assetId !== id),
        etfDetails: s.etfDetails.filter((e) => e.assetId !== id),
        depreciationItems: s.depreciationItems.filter((d) => d.assetId !== id),
      }));
    },

    addDepreciationItem: (d) => {
      const row: DepreciationItem = { ...d, id: uid("depr") };
      void upsertRow(TABLES.depreciationItems, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, depreciationItems: [...s.depreciationItems, row] }));
    },
    updateDepreciationItem: (id, patch) => {
      void updateRow(TABLES.depreciationItems, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, depreciationItems: s.depreciationItems.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
    },
    deleteDepreciationItem: (id) => {
      void deleteRow(TABLES.depreciationItems, id);
      set((s) => ({ ...s, depreciationItems: s.depreciationItems.filter((d) => d.id !== id) }));
    },

    addBuffer: (b) => {
      const row: CashBuffer = { ...b, id: uid("buf") };
      void upsertRow(TABLES.buffers, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, buffers: [...s.buffers, row] }));
    },
    updateBuffer: (id, patch) => {
      void updateRow(TABLES.buffers, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, buffers: s.buffers.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    },
    deleteBuffer: (id) => {
      void deleteRow(TABLES.buffers, id);
      set((s) => ({ ...s, buffers: s.buffers.filter((b) => b.id !== id) }));
    },

    addMaintenanceRequest: async (m) => {
      const row: MaintenanceRequest = {
        ...m,
        id: uid("mr"),
        createdAt: new Date().toISOString(),
        status: "Pending",
      };
      await upsertRow(TABLES.maintenanceRequests, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, maintenanceRequests: [...s.maintenanceRequests, row] }));
    },
    updateMaintenanceRequest: (id, m) => {
      void updateRow(TABLES.maintenanceRequests, id, m as Record<string, unknown>);
      set((s) => ({
        ...s,
        maintenanceRequests: s.maintenanceRequests.map((x) => (x.id === id ? { ...x, ...m } : x)),
      }));
    },
    deleteMaintenanceRequest: (id) => {
      void deleteRow(TABLES.maintenanceRequests, id);
      set((s) => ({ ...s, maintenanceRequests: s.maintenanceRequests.filter((x) => x.id !== id) }));
    },

    updateLandlordProfile: (p) =>
      set((s) => {
        const landlordProfile = { ...s.landlordProfile, ...p };
        void saveSettings({ landlordProfile });
        return { ...s, landlordProfile };
      }),
    updateLeaseTemplate: (t) =>
      set((s) => {
        void saveSettings({ leaseTemplate: t });
        return { ...s, leaseTemplate: t };
      }),
    updateTenantInfoStatement: (t) =>
      set((s) => {
        void saveSettings({ tenantInfoStatement: t });
        return { ...s, tenantInfoStatement: t };
      }),
    addReportHistoryEntry: (entry) =>
      set((s) => {
        const reportHistory = [entry, ...s.reportHistory].slice(0, 10);
        void saveSettings({ reportHistory });
        return { ...s, reportHistory };
      }),

    addBill: (b) => {
      const row: PropertyBill = { ...b, id: uid("bill") };
      void upsertRow(TABLES.bills, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, bills: [...s.bills, row] }));
    },
    updateBill: (id, b) => {
      void updateRow(TABLES.bills, id, b as Record<string, unknown>);
      set((s) => ({ ...s, bills: s.bills.map((x) => (x.id === id ? { ...x, ...b } : x)) }));
    },
    deleteBill: (id) => {
      void deleteRow(TABLES.bills, id);
      set((s) => ({ ...s, bills: s.bills.filter((x) => x.id !== id) }));
    },
    markBillPaid: (id, opts) =>
      set((s) => {
        const bill = s.bills.find((b) => b.id === id);
        if (!bill) return s;
        const paidDate = opts?.paidDate ?? new Date().toISOString().slice(0, 10);

        // Paying a bill posts it to Transactions/P&L too — this is the ONLY place a bill's
        // Expense ever gets created, for every bill regardless of source (bills never post at
        // intake anymore, even AI-confirmed ones — see 20260821150000).
        let linkedExpenseId = bill.linkedExpenseId;
        let newExpense: Expense | null = null;
        if (!linkedExpenseId) {
          newExpense = {
            id: uid("ex"),
            itemName: bill.providerName || bill.billType,
            cost: bill.amount,
            date: paidDate,
            propertyId: bill.propertyId,
            assetId: bill.assetId,
            // Falls back for bills saved before taxCategory existed on property_bills.
            taxCategory: bill.taxCategory ?? "Immediate Deduction",
            hasWarranty: false,
            rechargeToTenant: false,
            status: "approved",
            source: "manual",
            bpayBillerCode: bill.bpayBillerCode,
            bpayReference: bill.bpayReference,
          };
          linkedExpenseId = newExpense.id;
          void upsertRow(TABLES.expenses, newExpense as unknown as Record<string, unknown>);
        }

        void updateRow(TABLES.bills, id, { status: "Paid", paidDate, linkedExpenseId });
        const updated = s.bills.map((b) =>
          b.id === id ? { ...b, status: "Paid" as const, paidDate, linkedExpenseId } : b,
        );
        // Auto-create next cycle
        if (bill.recurrenceMonths && bill.recurrenceMonths > 0) {
          const next: PropertyBill = {
            ...bill,
            id: uid("bill"),
            dueDate: addMonthsISO(bill.dueDate, bill.recurrenceMonths),
            status: "Unpaid",
            paidDate: undefined,
            linkedExpenseId: undefined,
          };
          void upsertRow(TABLES.bills, { ...next, paidDate: null } as unknown as Record<string, unknown>);
          updated.push(next);
        }
        return { ...s, bills: updated, expenses: newExpense ? [...s.expenses, newExpense] : s.expenses };
      }),

    dismissProposal: (id) => {
      // Kept (not deleted) so the original forwarded document stays available in the Documents archive.
      void updateRow(TABLES.aiProposals, id, { status: "dismissed" });
      set((s) => ({
        ...s,
        aiProposals: s.aiProposals.map((x) => (x.id === id ? { ...x, status: "dismissed" as const } : x)),
      }));
    },
    markProposalApplied: (id) => {
      void updateRow(TABLES.aiProposals, id, { status: "applied" });
      set((s) => ({
        ...s,
        aiProposals: s.aiProposals.map((x) => (x.id === id ? { ...x, status: "applied" as const } : x)),
      }));
    },
    updateProposal: (id, patch) => {
      void updateRow(TABLES.aiProposals, id, patch as Record<string, unknown>);
      set((s) => ({
        ...s,
        aiProposals: s.aiProposals.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }));
    },
    addExpenseProposal: (p) => {
      const row: AiIntakeProposal = {
        id: uid("prop"),
        kind: "expense",
        status: "pending",
        propertyId: p.propertyId,
        reviewReason: p.reviewReason,
        payload: p.payload,
        sourceFileName: p.sourceFileName,
        sourceFileData: p.sourceFileData,
      };
      void upsertRow(TABLES.aiProposals, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, aiProposals: [...s.aiProposals, row] }));
    },

    setAiEnabled: (v) =>
      set((s) => {
        const aiConfig = { ...s.aiConfig, enabled: v };
        void saveSettings({ aiConfig });
        return { ...s, aiConfig };
      }),
    resetAiUsage: () =>
      set((s) => {
        const aiConfig = { ...s.aiConfig, dailyCount: 0, countDate: new Date().toISOString().slice(0, 10) };
        void saveSettings({ aiConfig });
        return { ...s, aiConfig };
      }),
    consumeAiBudget: () => {
      const today = new Date().toISOString().slice(0, 10);
      if (!state.aiConfig.enabled) return { ok: false, reason: "AI Co-Pilot APIs are disabled by Creator Master Panel." };
      const currentCount = state.aiConfig.countDate === today ? state.aiConfig.dailyCount : 0;
      if (currentCount >= state.aiConfig.dailyLimit) {
        return { ok: false, reason: "Daily AI Budget Limit Reached." };
      }
      setState((s) => {
        const aiConfig = {
          ...s.aiConfig,
          countDate: today,
          dailyCount: (s.aiConfig.countDate === today ? s.aiConfig.dailyCount : 0) + 1,
        };
        void saveSettings({ aiConfig });
        return { ...s, aiConfig };
      });
      return { ok: true };
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore outside provider");
  return c;
}
