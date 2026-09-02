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
  ProviderAgreement,
  ProviderProperty,
  Entity,
  ReportHistoryEntry,
  Asset,
  GoldDetails,
  EtfDetails,
  DepreciationItem,
  ValuationSnapshot,
  LoanBalanceSnapshot,
  CashBuffer,
  InsurancePolicy,
  MaintenanceItem,
  ComplianceCertificate,
  PropertyNote,
  ProviderDocument,
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
import { matchProviderByName } from "./providerMatch";
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
  providerAgreements: [],
  providerProperties: [],
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
  insurancePolicies: [],
  maintenanceItems: [],
  complianceCertificates: [],
  propertyNotes: [],
  providerDocuments: [],
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
  /** `keepRentalHub: true` wipes every financial/paperwork record for this property (bills,
   * transactions, loans, providers, depreciation, inspections, maintenance, AI proposals) but
   * leaves the property, its tenants and their rent-received history (ledger, invoices, rent
   * changes, lease history) in place — for "start a fresh document upload without losing who's
   * paid what". Omitted/false deletes the property itself and everything tied to it. */
  deleteProperty: (id: string, options?: { keepRentalHub?: boolean }) => void;

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
  updateLedger: (id: string, patch: Partial<LedgerEntry>) => void;

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

  addProvider: (p: Omit<Provider, "id">) => string;
  updateProvider: (id: string, p: Partial<Provider>) => void;
  deleteProvider: (id: string) => void;

  addProviderAgreement: (a: Omit<ProviderAgreement, "id">) => string;
  updateProviderAgreement: (id: string, a: Partial<ProviderAgreement>) => void;
  deleteProviderAgreement: (id: string) => void;

  addProviderProperty: (p: Omit<ProviderProperty, "id">) => string;
  deleteProviderProperty: (id: string) => void;
  /** Ensures a `provider_properties` tag exists for this (providerId, propertyId) pair — a no-op
   * if one already does. Called alongside findOrCreateProvider whenever a provider is being
   * attached to a specific property (a new agreement, a bill/expense/maintenance item, or
   * explicitly from a property's Providers tab), so that property's Providers tab picks it up. */
  ensureProviderProperty: (providerId: string, propertyId: string) => void;
  /** Re-points every row referencing `duplicateId` (provider_agreements, provider_properties,
   * expenses, property_bills, maintenance_items, provider_documents) onto `survivorId`, then
   * deletes the duplicate provider — used by the "Merge providers" tool on /providers to fix two
   * rows that turned out to be the same real-world business. Duplicates predating this action
   * mostly come from before findOrCreateProvider deduped portfolio-wide (it used to only dedup
   * within one property), or from a name typed two slightly different ways. */
  mergeProviders: (survivorId: string, duplicateId: string) => void;

  addEntity: (e: Omit<Entity, "id">) => void;
  updateEntity: (id: string, e: Partial<Entity>) => void;
  deleteEntity: (id: string) => void;
  /** Case-insensitive name match against existing entities; creates one if none matches. Returns
   * synchronously (the id is generated locally before the fire-and-forget DB write), so callers
   * can use the result immediately — e.g. as a new property's entityId in the same save. */
  findOrCreateEntity: (name: string, type: Entity["type"]) => string;
  /** Case-insensitive match-or-create against the Provider directory, scoped to one property —
   * used wherever a payee/provider name is typed on a Transaction or Expense so it lands in the
   * Providers list the same way a Bill's provider always has. */
  findOrCreateProvider: (name: string, propertyId?: string) => string;

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

  addInsurancePolicy: (p: Omit<InsurancePolicy, "id">) => void;
  updateInsurancePolicy: (id: string, p: Partial<InsurancePolicy>) => void;
  deleteInsurancePolicy: (id: string) => void;

  addMaintenanceItem: (m: Omit<MaintenanceItem, "id">) => void;
  updateMaintenanceItem: (id: string, m: Partial<MaintenanceItem>) => void;
  deleteMaintenanceItem: (id: string) => void;

  addComplianceCertificate: (c: Omit<ComplianceCertificate, "id">) => void;
  updateComplianceCertificate: (id: string, c: Partial<ComplianceCertificate>) => void;
  deleteComplianceCertificate: (id: string) => void;

  addPropertyNote: (n: Omit<PropertyNote, "id">) => void;
  updatePropertyNote: (id: string, n: Partial<PropertyNote>) => void;
  deletePropertyNote: (id: string) => void;

  addProviderDocument: (d: Omit<ProviderDocument, "id">) => void;
  updateProviderDocument: (id: string, d: Partial<ProviderDocument>) => void;
  deleteProviderDocument: (id: string) => void;

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
  /** `patch` lets a caller correct the proposal's own propertyId (or other fields) at the same
   * time it's marked applied — every review card lets the landlord override a wrong/missing
   * auto-match via a local dropdown, but that correction previously only flowed into whatever
   * record the confirm button created (a Property, an Expense, ...), never back onto the proposal
   * row itself. Since buildDocumentEntries files a document under the PROPOSAL's own propertyId,
   * an uncorrected proposal stayed permanently misfiled (or unfiled) even after a successful,
   * correctly-targeted confirm. */
  markProposalApplied: (id: string, patch?: Partial<AiIntakeProposal>) => void;
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
        providerAgreements,
        providerProperties,
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
        insurancePolicies,
        maintenanceItems,
        complianceCertificates,
        propertyNotes,
        providerDocuments,
        bills,
        aiProposals,
        emailInboxLog,
        settings,
      ] = await Promise.all([
        selectAll<Property>(TABLES.properties),
        selectAll<Tenant>(TABLES.tenants),
        selectAll<Provider>(TABLES.providers),
        selectAll<ProviderAgreement>(TABLES.providerAgreements),
        selectAll<ProviderProperty>(TABLES.providerProperties),
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
        selectAll<InsurancePolicy>(TABLES.insurancePolicies),
        selectAll<MaintenanceItem>(TABLES.maintenanceItems),
        selectAll<ComplianceCertificate>(TABLES.complianceCertificates),
        selectAll<PropertyNote>(TABLES.propertyNotes),
        selectAll<ProviderDocument>(TABLES.providerDocuments),
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
        providerAgreements,
        providerProperties,
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
        insurancePolicies,
        maintenanceItems,
        complianceCertificates,
        propertyNotes,
        providerDocuments,
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
    deleteProperty: (id, options) => {
      const keepRentalHub = options?.keepRentalHub ?? false;
      const assetId = state.properties.find((x) => x.id === id)?.assetId;
      const tenantIds = state.tenants.filter((t) => t.propertyId === id).map((t) => t.id);
      const loanIds = state.loans.filter((l) => l.propertyId === id).map((l) => l.id);

      // Financial/paperwork trail — always purged, in both modes.
      void deleteWhere(TABLES.loans, "propertyId", id);
      void deleteWhereIn(TABLES.loanBalanceSnapshots, "loanId", loanIds);
      void deleteWhere(TABLES.expenses, "propertyId", id);
      void deleteWhere(TABLES.inspections, "propertyId", id);
      void deleteWhere(TABLES.maintenanceRequests, "propertyId", id);
      void deleteWhere(TABLES.bills, "propertyId", id);
      void deleteWhere(TABLES.providers, "propertyId", id);
      void deleteWhere(TABLES.providerAgreements, "propertyId", id);
      void deleteWhere(TABLES.providerProperties, "propertyId", id);
      void deleteWhere(TABLES.aiProposals, "propertyId", id);
      void deleteWhere(TABLES.insurancePolicies, "propertyId", id);
      void deleteWhere(TABLES.maintenanceItems, "propertyId", id);
      void deleteWhere(TABLES.complianceCertificates, "propertyId", id);
      void deleteWhere(TABLES.propertyNotes, "propertyId", id);
      if (assetId) {
        void deleteWhere(TABLES.depreciationItems, "assetId", assetId);
        void deleteWhere(TABLES.valuationSnapshots, "assetId", assetId);
      }

      // The property itself, and its tenants' rent-received history — kept when keepRentalHub.
      if (!keepRentalHub) {
        void deleteRow(TABLES.properties, id);
        if (assetId) void deleteRow(TABLES.assets, assetId);
        void deleteWhere(TABLES.tenants, "propertyId", id);
        void deleteWhereIn(TABLES.ledger, "tenantId", tenantIds);
        void deleteWhereIn(TABLES.invoices, "tenantId", tenantIds);
        void deleteWhereIn(TABLES.rentChanges, "tenantId", tenantIds);
        void deleteWhereIn(TABLES.leaseHistory, "tenantId", tenantIds);
      }

      set((s) => ({
        ...s,
        properties: keepRentalHub ? s.properties : s.properties.filter((x) => x.id !== id),
        assets: keepRentalHub ? s.assets : s.assets.filter((a) => a.id !== assetId),
        tenants: keepRentalHub ? s.tenants : s.tenants.filter((t) => t.propertyId !== id),
        ledger: keepRentalHub ? s.ledger : s.ledger.filter((e) => !tenantIds.includes(e.tenantId)),
        invoices: keepRentalHub ? s.invoices : s.invoices.filter((i) => !tenantIds.includes(i.tenantId)),
        rentChanges: keepRentalHub ? s.rentChanges : s.rentChanges.filter((r) => !tenantIds.includes(r.tenantId)),
        leaseHistory: keepRentalHub ? s.leaseHistory : s.leaseHistory.filter((h) => !tenantIds.includes(h.tenantId)),
        depreciationItems: s.depreciationItems.filter((d) => d.assetId !== assetId),
        valuationSnapshots: s.valuationSnapshots.filter((v) => v.assetId !== assetId),
        loanBalanceSnapshots: s.loanBalanceSnapshots.filter((ls) => !loanIds.includes(ls.loanId)),
        loans: s.loans.filter((l) => l.propertyId !== id),
        expenses: s.expenses.filter((e) => e.propertyId !== id),
        inspections: s.inspections.filter((i) => i.propertyId !== id),
        maintenanceRequests: s.maintenanceRequests.filter((m) => m.propertyId !== id),
        bills: s.bills.filter((b) => b.propertyId !== id),
        providers: s.providers.filter((p) => p.propertyId !== id),
        providerAgreements: s.providerAgreements.filter((a) => a.propertyId !== id),
        providerProperties: s.providerProperties.filter((pp) => pp.propertyId !== id),
        aiProposals: s.aiProposals.filter((p) => p.propertyId !== id),
        insurancePolicies: s.insurancePolicies.filter((p) => p.propertyId !== id),
        maintenanceItems: s.maintenanceItems.filter((m) => m.propertyId !== id),
        complianceCertificates: s.complianceCertificates.filter((c) => c.propertyId !== id),
        propertyNotes: s.propertyNotes.filter((n) => n.propertyId !== id),
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
    updateLedger: (id, patch) =>
      set((s) => {
        const existing = s.ledger.find((e) => e.id === id);
        if (!existing) return s;
        void updateRow(TABLES.ledger, id, patch as Record<string, unknown>);
        const ledger = s.ledger.map((e) => (e.id === id ? { ...e, ...patch } : e));
        return {
          ...s,
          ledger,
          // A date/amount edit shifts this tenant's paid-up-to date the same way adding/deleting
          // a payment does, so it has to be recomputed here too, not just on add/delete.
          tenants: recomputePaidUp(patch.tenantId ?? existing.tenantId, s.tenants, ledger, s.rentChanges),
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
      return row.id;
    },
    updateProvider: (id, patch) => {
      void updateRow(TABLES.providers, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },
    deleteProvider: (id) => {
      void deleteRow(TABLES.providers, id);
      set((s) => ({
        ...s,
        providers: s.providers.filter((p) => p.id !== id),
        // Mirrors the DB's ON DELETE CASCADE on provider_documents/provider_agreements/
        // provider_properties.providerId — the cascade removes the DB rows automatically, but
        // local state needs the same cleanup so a just-deleted provider's documents/agreements/
        // property tags don't linger in the UI until next refresh().
        providerDocuments: s.providerDocuments.filter((d) => d.providerId !== id),
        providerAgreements: s.providerAgreements.filter((a) => a.providerId !== id),
        providerProperties: s.providerProperties.filter((pp) => pp.providerId !== id),
      }));
    },

    addProviderAgreement: (a) => {
      const row: ProviderAgreement = { ...a, id: uid("provagr") };
      void upsertRow(TABLES.providerAgreements, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, providerAgreements: [...s.providerAgreements, row] }));
      value.ensureProviderProperty(row.providerId, row.propertyId);
      return row.id;
    },
    updateProviderAgreement: (id, patch) => {
      void updateRow(TABLES.providerAgreements, id, patch as Record<string, unknown>);
      set((s) => ({
        ...s,
        providerAgreements: s.providerAgreements.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    deleteProviderAgreement: (id) => {
      void deleteRow(TABLES.providerAgreements, id);
      set((s) => ({ ...s, providerAgreements: s.providerAgreements.filter((a) => a.id !== id) }));
    },

    addProviderProperty: (p) => {
      const row: ProviderProperty = { ...p, id: uid("provprop") };
      void upsertRow(TABLES.providerProperties, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, providerProperties: [...s.providerProperties, row] }));
      return row.id;
    },
    deleteProviderProperty: (id) => {
      void deleteRow(TABLES.providerProperties, id);
      set((s) => ({ ...s, providerProperties: s.providerProperties.filter((pp) => pp.id !== id) }));
    },
    ensureProviderProperty: (providerId, propertyId) => {
      const exists = state.providerProperties.some((pp) => pp.providerId === providerId && pp.propertyId === propertyId);
      if (exists) return;
      const row: ProviderProperty = { id: uid("provprop"), providerId, propertyId };
      void upsertRow(TABLES.providerProperties, row as unknown as Record<string, unknown>);
      set((s) =>
        s.providerProperties.some((pp) => pp.providerId === providerId && pp.propertyId === propertyId)
          ? s
          : { ...s, providerProperties: [...s.providerProperties, row] },
      );
    },
    mergeProviders: (survivorId, duplicateId) => {
      if (survivorId === duplicateId) return;
      const agreementsToMove = state.providerAgreements.filter((a) => a.providerId === duplicateId);
      const propertiesToMove = state.providerProperties.filter((pp) => pp.providerId === duplicateId);
      const documentsToMove = state.providerDocuments.filter((d) => d.providerId === duplicateId);
      const expensesToMove = state.expenses.filter((e) => e.providerId === duplicateId);
      const billsToMove = state.bills.filter((b) => b.providerId === duplicateId);
      const maintenanceToMove = state.maintenanceItems.filter((m) => m.providerId === duplicateId);
      const survivorPropertyIds = new Set(
        state.providerProperties.filter((pp) => pp.providerId === survivorId).map((pp) => pp.propertyId),
      );

      for (const a of agreementsToMove) void updateRow(TABLES.providerAgreements, a.id, { providerId: survivorId });
      // provider_properties is unique on (providerId, propertyId) — re-pointing a tag the
      // survivor already has for that property would violate the constraint, so those are
      // deleted instead of re-pointed.
      for (const pp of propertiesToMove) {
        if (survivorPropertyIds.has(pp.propertyId)) void deleteRow(TABLES.providerProperties, pp.id);
        else void updateRow(TABLES.providerProperties, pp.id, { providerId: survivorId });
      }
      for (const d of documentsToMove) void updateRow(TABLES.providerDocuments, d.id, { providerId: survivorId });
      for (const e of expensesToMove) void updateRow(TABLES.expenses, e.id, { providerId: survivorId });
      for (const b of billsToMove) void updateRow(TABLES.bills, b.id, { providerId: survivorId });
      for (const m of maintenanceToMove) void updateRow(TABLES.maintenanceItems, m.id, { providerId: survivorId });
      void deleteRow(TABLES.providers, duplicateId);

      set((s) => ({
        ...s,
        providers: s.providers.filter((p) => p.id !== duplicateId),
        providerAgreements: s.providerAgreements.map((a) =>
          a.providerId === duplicateId ? { ...a, providerId: survivorId } : a,
        ),
        providerProperties: s.providerProperties
          .filter((pp) => !(pp.providerId === duplicateId && survivorPropertyIds.has(pp.propertyId)))
          .map((pp) => (pp.providerId === duplicateId ? { ...pp, providerId: survivorId } : pp)),
        providerDocuments: s.providerDocuments.map((d) =>
          d.providerId === duplicateId ? { ...d, providerId: survivorId } : d,
        ),
        expenses: s.expenses.map((e) => (e.providerId === duplicateId ? { ...e, providerId: survivorId } : e)),
        bills: s.bills.map((b) => (b.providerId === duplicateId ? { ...b, providerId: survivorId } : b)),
        maintenanceItems: s.maintenanceItems.map((m) =>
          m.providerId === duplicateId ? { ...m, providerId: survivorId } : m,
        ),
      }));
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

    /** A payee typed on a Transaction/Expense (or bill) is matched case-insensitively against the
     * Provider directory, portfolio-wide (identity is no longer scoped to one property — see the
     * Provider/ProviderAgreement split), so "Miracle Vibes Cleaning" typed twice at two different
     * properties reuses one Provider row instead of creating a duplicate identity. When called
     * with a propertyId, also ensures a `provider_properties` tag exists for that pair, so the
     * provider shows up on that property's Providers tab. */
    findOrCreateProvider: (name, propertyId) => {
      const trimmed = name.trim();
      const existing = matchProviderByName(state.providers, trimmed);
      const id = existing ? existing.id : uid("prov");
      if (!existing) {
        const row: Provider = { id, name: trimmed, role: "Other" };
        void upsertRow(TABLES.providers, row as unknown as Record<string, unknown>);
        set((s) => ({ ...s, providers: [...s.providers, row] }));
      }
      if (propertyId) value.ensureProviderProperty(id, propertyId);
      return id;
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

    addInsurancePolicy: (p) => {
      const row: InsurancePolicy = { ...p, id: uid("ins") };
      void upsertRow(TABLES.insurancePolicies, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, insurancePolicies: [...s.insurancePolicies, row] }));
    },
    updateInsurancePolicy: (id, patch) => {
      void updateRow(TABLES.insurancePolicies, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, insurancePolicies: s.insurancePolicies.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },
    deleteInsurancePolicy: (id) => {
      void deleteRow(TABLES.insurancePolicies, id);
      set((s) => ({ ...s, insurancePolicies: s.insurancePolicies.filter((p) => p.id !== id) }));
    },

    addMaintenanceItem: (m) => {
      const row: MaintenanceItem = { ...m, id: uid("mi") };
      void upsertRow(TABLES.maintenanceItems, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, maintenanceItems: [...s.maintenanceItems, row] }));
    },
    updateMaintenanceItem: (id, patch) => {
      void updateRow(TABLES.maintenanceItems, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, maintenanceItems: s.maintenanceItems.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    },
    deleteMaintenanceItem: (id) => {
      void deleteRow(TABLES.maintenanceItems, id);
      set((s) => ({ ...s, maintenanceItems: s.maintenanceItems.filter((m) => m.id !== id) }));
    },

    addComplianceCertificate: (c) => {
      const row: ComplianceCertificate = { ...c, id: uid("cc") };
      void upsertRow(TABLES.complianceCertificates, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, complianceCertificates: [...s.complianceCertificates, row] }));
    },
    updateComplianceCertificate: (id, patch) => {
      void updateRow(TABLES.complianceCertificates, id, patch as Record<string, unknown>);
      set((s) => ({
        ...s,
        complianceCertificates: s.complianceCertificates.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },
    deleteComplianceCertificate: (id) => {
      void deleteRow(TABLES.complianceCertificates, id);
      set((s) => ({ ...s, complianceCertificates: s.complianceCertificates.filter((c) => c.id !== id) }));
    },

    addPropertyNote: (n) => {
      const row: PropertyNote = { ...n, id: uid("note") };
      void upsertRow(TABLES.propertyNotes, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, propertyNotes: [...s.propertyNotes, row] }));
    },
    updatePropertyNote: (id, patch) => {
      void updateRow(TABLES.propertyNotes, id, patch as Record<string, unknown>);
      set((s) => ({ ...s, propertyNotes: s.propertyNotes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    },
    deletePropertyNote: (id) => {
      void deleteRow(TABLES.propertyNotes, id);
      set((s) => ({ ...s, propertyNotes: s.propertyNotes.filter((n) => n.id !== id) }));
    },

    addProviderDocument: (d) => {
      const row: ProviderDocument = { ...d, id: uid("provdoc") };
      void upsertRow(TABLES.providerDocuments, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, providerDocuments: [...s.providerDocuments, row] }));
    },
    updateProviderDocument: (id, patch) => {
      void updateRow(TABLES.providerDocuments, id, patch as Record<string, unknown>);
      set((s) => ({
        ...s,
        providerDocuments: s.providerDocuments.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      }));
    },
    deleteProviderDocument: (id) => {
      void deleteRow(TABLES.providerDocuments, id);
      set((s) => ({ ...s, providerDocuments: s.providerDocuments.filter((d) => d.id !== id) }));
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
            unitId: bill.unitId,
            // Falls back for bills saved before taxCategory existed on property_bills.
            taxCategory: bill.taxCategory ?? "Immediate Deduction",
            category: bill.category,
            hasWarranty: false,
            rechargeToTenant: false,
            status: "approved",
            source: "manual",
            bpayBillerCode: bill.bpayBillerCode,
            bpayReference: bill.bpayReference,
            // Previously dropped on conversion, which silently un-linked the provider directory
            // entry and the actual bill PDF the moment a bill was marked paid — the Transactions
            // row then showed neither a provider nor a working invoice link even though both were
            // right there on the Bill.
            providerName: bill.providerName,
            providerId: bill.providerId,
            invoiceFileName: bill.sourceFileName,
            invoiceFileData: bill.sourceFileData,
          };
          linkedExpenseId = newExpense.id;
          void upsertRow(TABLES.expenses, newExpense as unknown as Record<string, unknown>);
          if (bill.providerName && !bill.providerId) {
            value.findOrCreateProvider(bill.providerName, bill.propertyId);
          }
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
    markProposalApplied: (id, patch) => {
      void updateRow(TABLES.aiProposals, id, { status: "applied", ...patch });
      set((s) => ({
        ...s,
        aiProposals: s.aiProposals.map((x) => (x.id === id ? { ...x, ...patch, status: "applied" as const } : x)),
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
