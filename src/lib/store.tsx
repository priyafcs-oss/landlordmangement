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
  LeaseTemplateConfig,
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
import { paidUpToDateFromPayments } from "./calculations";

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

const empty: AppState = {
  properties: [],
  tenants: [],
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
  leaseTemplate: null,
  tenantInfoStatement: null,
};

interface StoreCtx {
  state: AppState;
  loading: boolean;
  refresh: () => Promise<void>;
  set: (updater: (s: AppState) => AppState) => void;
  reset: () => void;

  addProperty: (p: Omit<Property, "id">) => void;
  updateProperty: (id: string, p: Partial<Property>) => void;
  deleteProperty: (id: string) => void;

  addTenant: (t: Omit<Tenant, "id" | "paidUpToDate"> & { paidUpToDate?: string }) => void;
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

  addExpense: (e: Omit<Expense, "id">) => void;
  updateExpense: (id: string, e: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;

  addInspection: (i: Omit<Inspection, "id">) => void;
  updateInspection: (id: string, i: Partial<Inspection>) => void;
  deleteInspection: (id: string) => void;

  addRentChange: (r: Omit<RentChange, "id">) => void;
  addLeaseHistory: (h: Omit<LeaseHistory, "id">) => void;

  addMaintenanceRequest: (m: Omit<MaintenanceRequest, "id" | "createdAt" | "status">) => Promise<void>;
  updateMaintenanceRequest: (id: string, m: Partial<MaintenanceRequest>) => void;
  deleteMaintenanceRequest: (id: string) => void;

  updateLandlordProfile: (p: Partial<LandlordProfile>) => void;
  updateLeaseTemplate: (t: LeaseTemplateConfig | null) => void;
  updateTenantInfoStatement: (t: AppState["tenantInfoStatement"]) => void;

  addBill: (b: Omit<PropertyBill, "id">) => void;
  updateBill: (id: string, b: Partial<PropertyBill>) => void;
  deleteBill: (id: string) => void;
  markBillPaid: (id: string) => void;

  dismissProposal: (id: string) => void;
  markProposalApplied: (id: string) => void;

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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(empty);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [
      properties,
      tenants,
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
      settings,
    ] = await Promise.all([
      selectAll<Property>(TABLES.properties),
      selectAll<Tenant>(TABLES.tenants),
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
      loadSettings(),
    ]);
    setState({
      properties,
      tenants,
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
      aiConfig: { ...defaultAi, ...((settings?.aiConfig as AiConfig) ?? {}) },
      landlordProfile: { ...defaultProfile, ...((settings?.landlordProfile as LandlordProfile) ?? {}) },
      leaseTemplate: (settings?.leaseTemplate as LeaseTemplateConfig | undefined) ?? null,
      tenantInfoStatement:
        (settings?.tenantInfoStatement as AppState["tenantInfoStatement"] | undefined) ?? null,
    });
    setLoading(false);
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
      const row: Property = { ...p, id: uid("p") };
      void upsertRow(TABLES.properties, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, properties: [...s.properties, row] }));
    },
    updateProperty: (id, p) => {
      void updateRow(TABLES.properties, id, p as Record<string, unknown>);
      set((s) => ({ ...s, properties: s.properties.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
    },
    deleteProperty: (id) => {
      const tenantIds = state.tenants.filter((t) => t.propertyId === id).map((t) => t.id);
      void deleteRow(TABLES.properties, id);
      void deleteWhere(TABLES.tenants, "propertyId", id);
      void deleteWhere(TABLES.loans, "propertyId", id);
      void deleteWhere(TABLES.expenses, "propertyId", id);
      void deleteWhere(TABLES.inspections, "propertyId", id);
      void deleteWhere(TABLES.bills, "propertyId", id);
      void deleteWhereIn(TABLES.ledger, "tenantId", tenantIds);
      void deleteWhereIn(TABLES.invoices, "tenantId", tenantIds);
      set((s) => ({
        ...s,
        properties: s.properties.filter((x) => x.id !== id),
        tenants: s.tenants.filter((t) => t.propertyId !== id),
        loans: s.loans.filter((l) => l.propertyId !== id),
        expenses: s.expenses.filter((e) => e.propertyId !== id),
        inspections: s.inspections.filter((i) => i.propertyId !== id),
        bills: s.bills.filter((b) => b.propertyId !== id),
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
      set((s) => ({ ...s, loans: [...s.loans, row] }));
    },
    updateLoan: (id, l) => {
      void updateRow(TABLES.loans, id, l as Record<string, unknown>);
      set((s) => ({ ...s, loans: s.loans.map((x) => (x.id === id ? { ...x, ...l } : x)) }));
    },
    deleteLoan: (id) => {
      void deleteRow(TABLES.loans, id);
      set((s) => ({ ...s, loans: s.loans.filter((x) => x.id !== id) }));
    },

    addExpense: (e) => {
      const row: Expense = { ...e, id: uid("ex") };
      void upsertRow(TABLES.expenses, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, expenses: [...s.expenses, row] }));
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
    addLeaseHistory: (h) => {
      const row: LeaseHistory = { ...h, id: uid("lh") };
      void upsertRow(TABLES.leaseHistory, row as unknown as Record<string, unknown>);
      set((s) => ({ ...s, leaseHistory: [...s.leaseHistory, row] }));
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
    markBillPaid: (id) =>
      set((s) => {
        const bill = s.bills.find((b) => b.id === id);
        if (!bill) return s;
        const today = new Date().toISOString().slice(0, 10);
        void updateRow(TABLES.bills, id, { status: "Paid", paidDate: today });
        const updated = s.bills.map((b) =>
          b.id === id ? { ...b, status: "Paid" as const, paidDate: today } : b,
        );
        // Auto-create next cycle
        if (bill.recurrenceMonths && bill.recurrenceMonths > 0) {
          const next: PropertyBill = {
            ...bill,
            id: uid("bill"),
            dueDate: addMonthsISO(bill.dueDate, bill.recurrenceMonths),
            status: "Unpaid",
            paidDate: undefined,
          };
          void upsertRow(TABLES.bills, { ...next, paidDate: null } as unknown as Record<string, unknown>);
          updated.push(next);
        }
        return { ...s, bills: updated };
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
