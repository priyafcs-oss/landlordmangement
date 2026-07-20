export type RentFrequency = "Weekly" | "Fortnightly" | "Monthly";
export type LeaseDuration = "6 Months" | "12 Months" | "Periodic";

export interface Property {
  id: string;
  address: string;
  purchasePrice: number;
  currentValue: number;
}

export interface Tenant {
  id: string;
  name: string; // required
  rentAmount: number; // required
  rentFrequency: RentFrequency; // required
  email?: string;
  phone?: string;
  propertyId: string;
  leaseStart?: string;
  leaseExpiry?: string; // empty string / undefined = Periodic
  leaseDuration?: LeaseDuration;
  lastRentIncreaseDate?: string;
  bankReference?: string;
  bankAccountHolder?: string;
  paidUpToDate: string;
  bondAmount?: number;
  bondLodgementDate?: string;
  bondReceiptNumber?: string;
  leaseDocumentFileName?: string;
  leaseDocumentFileData?: string; // base64 (simulated Supabase Storage)
}

export type LedgerType =
  | "Rent Payment"
  | "Water Invoice"
  | "Maintenance Charge"
  | "Manual Credit"
  | "Adjustment Credit"
  | "Adjustment Debit"
  | "Rent Due";

export interface LedgerEntry {
  id: string;
  tenantId: string;
  date: string;
  type: LedgerType;
  description: string;
  debit: number;
  credit: number;
  newPaidUpToDate?: string;
  manual?: boolean;
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
  invoiceFileData?: string;
  hasWarranty: boolean;
  warrantyExpiry?: string;
  rechargeToTenant: boolean;
  tenantId?: string;
}

export interface ChecklistItem {
  label: string;
  result?: "Pass" | "Fail" | "N/A";
  notes?: string;
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
  checklist?: ChecklistItem[];
  photos?: { name: string; data: string }[];
  signature?: string; // typed-name digital signature
}

export interface RentChange {
  id: string;
  tenantId: string;
  changeDate: string;
  oldRent: number;
  newRent: number;
}

export interface LeaseHistory {
  id: string;
  tenantId: string;
  originalStartDate: string;
  pastStartDate: string;
  pastEndDate: string;
  pastRent: number;
  pastFrequency: RentFrequency;
}

export interface MaintenanceRequest {
  id: string;
  propertyId: string;
  category: string;
  description: string;
  photos: { name: string; data: string }[];
  status: "Pending" | "Converted" | "Dismissed";
  contactName?: string;
  contactPhone?: string;
  createdAt: string;
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
  leaseHistory: LeaseHistory[];
  maintenanceRequests: MaintenanceRequest[];
}

// Predefined inspection checklist templates
export const INSPECTION_TEMPLATES: Record<Inspection["type"], string[]> = {
  Entry: [
    "Front door & locks",
    "Kitchen appliances",
    "Bathroom fixtures",
    "Walls & paint",
    "Floors & carpet",
    "Windows & screens",
    "Smoke alarms",
    "Yard / external",
  ],
  Routine: [
    "Kitchen",
    "Bathroom",
    "Walls",
    "Floors",
    "Smoke alarms",
    "General cleanliness",
  ],
  Exit: [
    "Front door & locks",
    "Kitchen (clean)",
    "Bathroom (clean)",
    "Walls (damage)",
    "Floors & carpet (clean)",
    "Windows & screens",
    "Smoke alarms",
    "Keys returned",
    "Yard / external",
  ],
};
