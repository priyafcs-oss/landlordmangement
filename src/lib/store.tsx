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
} from "./types";

const STORAGE_KEY = "landlord-app-v4";

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
};

function load(): AppState {
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...empty,
        ...parsed,
        aiConfig: { ...defaultAi, ...(parsed.aiConfig ?? {}) },
        landlordProfile: { ...defaultProfile, ...(parsed.landlordProfile ?? {}) },
        bills: parsed.bills ?? [],
      };
    }
  } catch {}
  return empty;
}

interface StoreCtx {
  state: AppState;
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
    args: { newStart: string; newEnd?: string; newDuration?: Tenant["leaseDuration"]; newRent: number; newFrequency?: Tenant["rentFrequency"] },
  ) => void;

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

  addMaintenanceRequest: (m: Omit<MaintenanceRequest, "id" | "createdAt" | "status">) => void;
  updateMaintenanceRequest: (id: string, m: Partial<MaintenanceRequest>) => void;
  deleteMaintenanceRequest: (id: string) => void;

  updateLandlordProfile: (p: Partial<LandlordProfile>) => void;

  addBill: (b: Omit<PropertyBill, "id">) => void;
  updateBill: (id: string, b: Partial<PropertyBill>) => void;
  deleteBill: (id: string) => void;
  markBillPaid: (id: string) => void;

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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(load());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  const set: StoreCtx["set"] = (updater) => setState((s) => updater(s));

  const value: StoreCtx = {
    state,
    set,
    reset: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setState({ ...empty, aiConfig: { ...defaultAi }, landlordProfile: { ...defaultProfile } });
    },
    addProperty: (p) => set((s) => ({ ...s, properties: [...s.properties, { ...p, id: uid("p") }] })),
    updateProperty: (id, p) => set((s) => ({ ...s, properties: s.properties.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
    deleteProperty: (id) =>
      set((s) => ({
        ...s,
        properties: s.properties.filter((x) => x.id !== id),
        tenants: s.tenants.filter((t) => t.propertyId !== id),
        loans: s.loans.filter((l) => l.propertyId !== id),
        expenses: s.expenses.filter((e) => e.propertyId !== id),
        inspections: s.inspections.filter((i) => i.propertyId !== id),
        bills: s.bills.filter((b) => b.propertyId !== id),
      })),

    addTenant: (t) =>
      set((s) => {
        // Paid-up default = one day BEFORE lease start (so day 1 of lease reads as first due day)
        let defaultPaidUp = new Date().toISOString().slice(0, 10);
        if (t.leaseStart) {
          const d = new Date(t.leaseStart);
          d.setDate(d.getDate() - 1);
          defaultPaidUp = d.toISOString().slice(0, 10);
        }
        return {
          ...s,
          tenants: [
            ...s.tenants,
            { ...t, paidUpToDate: t.paidUpToDate || defaultPaidUp, id: uid("t") },
          ],
        };
      }),
    updateTenant: (id, patch) =>
      set((s) => {
        const prev = s.tenants.find((x) => x.id === id);
        const nextTenants = s.tenants.map((x) => (x.id === id ? { ...x, ...patch } : x));
        let rentChanges = s.rentChanges;
        if (prev && patch.rentAmount !== undefined && patch.rentAmount !== prev.rentAmount) {
          rentChanges = [
            ...rentChanges,
            {
              id: uid("rc"),
              tenantId: id,
              changeDate: new Date().toISOString().slice(0, 10),
              oldRent: prev.rentAmount,
              newRent: patch.rentAmount,
            },
          ];
        }
        return { ...s, tenants: nextTenants, rentChanges };
      }),
    deleteTenant: (id) =>
      set((s) => ({
        ...s,
        tenants: s.tenants.filter((x) => x.id !== id),
        ledger: s.ledger.filter((e) => e.tenantId !== id),
        invoices: s.invoices.filter((i) => i.tenantId !== id),
        rentChanges: s.rentChanges.filter((r) => r.tenantId !== id),
        leaseHistory: s.leaseHistory.filter((r) => r.tenantId !== id),
      })),

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
        };
        const rentChanges =
          args.newRent !== prev.rentAmount
            ? [
                ...s.rentChanges,
                {
                  id: uid("rc"),
                  tenantId,
                  changeDate: new Date().toISOString().slice(0, 10),
                  oldRent: prev.rentAmount,
                  newRent: args.newRent,
                },
              ]
            : s.rentChanges;
        return {
          ...s,
          leaseHistory: [...s.leaseHistory, history],
          rentChanges,
          tenants: s.tenants.map((t) =>
            t.id === tenantId
              ? {
                  ...t,
                  leaseStart: args.newStart,
                  leaseExpiry: args.newEnd || undefined,
                  leaseDuration: args.newDuration ?? t.leaseDuration,
                  rentAmount: args.newRent,
                  rentFrequency: args.newFrequency ?? t.rentFrequency,
                  lastRentIncreaseDate:
                    args.newRent !== prev.rentAmount ? new Date().toISOString().slice(0, 10) : t.lastRentIncreaseDate,
                }
              : t,
          ),
        };
      }),

    addLedger: (e) => set((s) => ({ ...s, ledger: [...s.ledger, { ...e, id: uid("le") }] })),
    deleteLedger: (id) => set((s) => ({ ...s, ledger: s.ledger.filter((e) => e.id !== id) })),

    addInvoice: (i) => set((s) => ({ ...s, invoices: [...s.invoices, { ...i, id: uid("inv") }] })),
    updateInvoice: (id, i) => set((s) => ({ ...s, invoices: s.invoices.map((x) => (x.id === id ? { ...x, ...i } : x)) })),
    deleteInvoice: (id) => set((s) => ({ ...s, invoices: s.invoices.filter((x) => x.id !== id) })),

    addLoan: (l) => set((s) => ({ ...s, loans: [...s.loans, { ...l, id: uid("l") }] })),
    updateLoan: (id, l) => set((s) => ({ ...s, loans: s.loans.map((x) => (x.id === id ? { ...x, ...l } : x)) })),
    deleteLoan: (id) => set((s) => ({ ...s, loans: s.loans.filter((x) => x.id !== id) })),

    addExpense: (e) => set((s) => ({ ...s, expenses: [...s.expenses, { ...e, id: uid("ex") }] })),
    updateExpense: (id, e) => set((s) => ({ ...s, expenses: s.expenses.map((x) => (x.id === id ? { ...x, ...e } : x)) })),
    deleteExpense: (id) => set((s) => ({ ...s, expenses: s.expenses.filter((x) => x.id !== id) })),

    addInspection: (i) => set((s) => ({ ...s, inspections: [...s.inspections, { ...i, id: uid("ins") }] })),
    updateInspection: (id, i) =>
      set((s) => ({ ...s, inspections: s.inspections.map((x) => (x.id === id ? { ...x, ...i } : x)) })),
    deleteInspection: (id) => set((s) => ({ ...s, inspections: s.inspections.filter((x) => x.id !== id) })),

    addRentChange: (r) => set((s) => ({ ...s, rentChanges: [...s.rentChanges, { ...r, id: uid("rc") }] })),
    addLeaseHistory: (h) => set((s) => ({ ...s, leaseHistory: [...s.leaseHistory, { ...h, id: uid("lh") }] })),

    addMaintenanceRequest: (m) =>
      set((s) => ({
        ...s,
        maintenanceRequests: [
          ...s.maintenanceRequests,
          { ...m, id: uid("mr"), createdAt: new Date().toISOString(), status: "Pending" },
        ],
      })),
    updateMaintenanceRequest: (id, m) =>
      set((s) => ({
        ...s,
        maintenanceRequests: s.maintenanceRequests.map((x) => (x.id === id ? { ...x, ...m } : x)),
      })),
    deleteMaintenanceRequest: (id) =>
      set((s) => ({ ...s, maintenanceRequests: s.maintenanceRequests.filter((x) => x.id !== id) })),

    updateLandlordProfile: (p) =>
      set((s) => ({ ...s, landlordProfile: { ...s.landlordProfile, ...p } })),

    addBill: (b) => set((s) => ({ ...s, bills: [...s.bills, { ...b, id: uid("bill") }] })),
    updateBill: (id, b) =>
      set((s) => ({ ...s, bills: s.bills.map((x) => (x.id === id ? { ...x, ...b } : x)) })),
    deleteBill: (id) => set((s) => ({ ...s, bills: s.bills.filter((x) => x.id !== id) })),
    markBillPaid: (id) =>
      set((s) => {
        const bill = s.bills.find((b) => b.id === id);
        if (!bill) return s;
        const today = new Date().toISOString().slice(0, 10);
        const updated = s.bills.map((b) =>
          b.id === id ? { ...b, status: "Paid" as const, paidDate: today } : b,
        );
        // Auto-create next cycle
        if (bill.recurrenceMonths && bill.recurrenceMonths > 0) {
          const nextDue = addMonthsISO(bill.dueDate, bill.recurrenceMonths);
          updated.push({
            ...bill,
            id: uid("bill"),
            dueDate: nextDue,
            status: "Unpaid",
            paidDate: undefined,
          });
        }
        return { ...s, bills: updated };
      }),

    setAiEnabled: (v) => set((s) => ({ ...s, aiConfig: { ...s.aiConfig, enabled: v } })),
    resetAiUsage: () =>
      set((s) => ({
        ...s,
        aiConfig: { ...s.aiConfig, dailyCount: 0, countDate: new Date().toISOString().slice(0, 10) },
      })),
    consumeAiBudget: () => {
      const today = new Date().toISOString().slice(0, 10);
      if (!state.aiConfig.enabled) return { ok: false, reason: "AI Co-Pilot APIs are disabled by Creator Master Panel." };
      const currentCount = state.aiConfig.countDate === today ? state.aiConfig.dailyCount : 0;
      if (currentCount >= state.aiConfig.dailyLimit) {
        return { ok: false, reason: "Daily AI Budget Limit Reached." };
      }
      setState((s) => ({
        ...s,
        aiConfig: {
          ...s.aiConfig,
          countDate: today,
          dailyCount: (s.aiConfig.countDate === today ? s.aiConfig.dailyCount : 0) + 1,
        },
      }));
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
