export type RentFrequency = "Weekly" | "Fortnightly" | "Monthly";

export interface Property {
  id: string;
  address: string;
  purchasePrice: number;
  currentValue: number;
}

export interface Tenant {
  id: string;
  name: string;
  email: string;
  propertyId: string;
  leaseStart: string; // ISO date
  leaseExpiry: string;
  rentAmount: number;
  rentFrequency: RentFrequency;
  bankReference: string;
  bankAccountHolder: string;
  paidUpToDate: string; // ISO
  bondAmount?: number;
  bondLodgementDate?: string;
  bondReceiptNumber?: string;
}

export type LedgerType =
  | "Rent Payment"
  | "Water Invoice"
  | "Maintenance Charge"
  | "Manual Credit"
  | "Rent Due";

export interface LedgerEntry {
  id: string;
  tenantId: string;
  date: string;
  type: LedgerType;
  description: string;
  debit: number; // amount due
  credit: number; // amount paid
  newPaidUpToDate?: string;
  manual?: boolean; // manual credit shouldn't be auto-regenerated
  linkedInvoiceId?: string;
}

export interface TenantInvoice {
  id: string;
  tenantId: string;
  chargeType: "Water Usage" | "Tenant Damage" | "Other";
  amountDue: number;
  dateIssued: string;
  dueDate: string;
  status: "Unpaid" | "Paid";
  description?: string;
}

export interface Loan {
  id: string;
  propertyId: string;
  bankName: string;
  totalBalance: number;
  interestRate: number;
  monthlyEmi: number;
}

export interface Expense {
  id: string;
  itemName: string;
  cost: number;
  date: string;
  propertyId: string;
  taxCategory: "Immediate Deduction" | "Capital Works";
  invoiceFileName?: string;
  invoiceFileData?: string; // base64 data URL for simulated storage
  hasWarranty: boolean;
  warrantyExpiry?: string;
  rechargeToTenant: boolean;
  tenantId?: string;
}

export interface Inspection {
  id: string;
  propertyId: string;
  date: string;
  type: "Entry" | "Routine" | "Exit";
  status: "Scheduled" | "Completed";
  notes?: string;
  fileFileName?: string;
  fileData?: string;
}

export interface RentChange {
  id: string;
  tenantId: string;
  changeDate: string;
  oldRent: number;
  newRent: number;
}

export interface AppState {
  properties: Property[];
  tenants: Tenant[];
  ledger: LedgerEntry[];
  invoices: TenantInvoice[];
  loans: Loan[];
  expenses: Expense[];
  inspections: Inspection[];
  rentChanges: RentChange[];
}
