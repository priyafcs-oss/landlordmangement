import type { Tenant, TenantInvoice } from "@/lib/types";

export type DashboardReminder = {
  id: string;
  source: "manual" | "invoice";
  title: string;
  propertyId?: string;
  tenantId?: string;
  dueDate?: string;
  completed: boolean;
  createdAt: string;
  invoiceId?: string;
};

export const DASHBOARD_REMINDERS_KEY = "landlordmangement.dashboard-reminders";

export function loadDashboardReminders(): DashboardReminder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DASHBOARD_REMINDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DashboardReminder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDashboardReminders(items: DashboardReminder[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DASHBOARD_REMINDERS_KEY, JSON.stringify(items));
}

export function upsertInvoiceReminder(invoice: TenantInvoice, tenant?: Tenant, propertyId?: string): DashboardReminder {
  const items = loadDashboardReminders();
  const existing = items.find((item) => item.source === "invoice" && item.invoiceId === invoice.id);
  const next: DashboardReminder = {
    id: invoice.id,
    source: "invoice",
    title: invoice.description || invoice.chargeType,
    propertyId: propertyId ?? tenant?.propertyId,
    tenantId: tenant?.id,
    dueDate: invoice.dueDate,
    completed: existing?.completed ?? false,
    createdAt: existing?.createdAt ?? invoice.dateIssued ?? new Date().toISOString(),
    invoiceId: invoice.id,
  };
  const filtered = items.filter((item) => !(item.source === "invoice" && item.invoiceId === invoice.id));
  saveDashboardReminders([next, ...filtered]);
  return next;
}

export function setDashboardReminderCompleted(invoiceId: string, completed: boolean) {
  const items = loadDashboardReminders();
  const next = items.map((item) =>
    item.source === "invoice" && item.invoiceId === invoiceId ? { ...item, completed } : item,
  );
  saveDashboardReminders(next);
}

export function getDashboardReminder(invoiceId: string) {
  return loadDashboardReminders().find((item) => item.source === "invoice" && item.invoiceId === invoiceId);
}
