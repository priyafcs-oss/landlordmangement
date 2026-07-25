export type RentFrequency = "Weekly" | "Fortnightly" | "Monthly";
export type LeaseDuration = "6 Months" | "12 Months" | "Periodic";

export interface Property {
  id: string;
  address: string;
  purchasePrice: number;
  currentValue: number;
  /** Optional short unique code tenants type into public maintenance form */
  tenantCode?: string;
}

export interface Tenant {
  id: string;
  name: string; // required
  rentAmount: number; // required
  rentFrequency: RentFrequency; // required
  email?: string;
  phone?: string;
  emergencyContact?: string;
  permanentAddress?: string;
  noticePeriod?: string; // e.g. "14 days"
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
  idProofFileName?: string;
  idProofFileData?: string;
  bondTransferFileName?: string;
  bondTransferFileData?: string;
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
  photoData?: string;
  photoName?: string;
}

export interface ChecklistRoom {
  name: string;
  items: ChecklistItem[];
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
  /** Legacy flat checklist — kept for backwards compat */
  checklist?: ChecklistItem[];
  /** New: rooms with items, dynamically added/removed */
  rooms?: ChecklistRoom[];
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
  /** Resolved property id if the typed address/code matched an existing property */
  propertyId?: string;
  /** Free-text address or tenant code as typed by the reporter */
  propertyAddressTyped: string;
  category: string;
  description: string;
  urgency: "Low" | "Medium" | "High";
  photos: { name: string; data: string }[];
  video?: { name: string; data: string };
  status: "Pending" | "Converted" | "Dismissed";
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  createdAt: string;
}

export interface AiConfig {
  enabled: boolean;
  dailyCount: number;
  countDate: string; // YYYY-MM-DD
  dailyLimit: number;
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
  aiConfig: AiConfig;
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

export const DEFAULT_INSPECTION_ROOMS: Record<Inspection["type"], ChecklistRoom[]> = {
  Entry: [
    { name: "Entry / Exterior", items: [{ label: "Front door & locks" }, { label: "Yard / external" }] },
    { name: "Kitchen", items: [{ label: "Appliances" }, { label: "Cabinets & bench" }] },
    { name: "Bathroom", items: [{ label: "Fixtures" }, { label: "Tiles & grout" }] },
    { name: "Living areas", items: [{ label: "Walls & paint" }, { label: "Floors & carpet" }, { label: "Windows & screens" }, { label: "Smoke alarms" }] },
  ],
  Routine: [
    { name: "Kitchen", items: [{ label: "Cleanliness" }, { label: "Appliances working" }] },
    { name: "Bathroom", items: [{ label: "Cleanliness" }, { label: "Leaks / mould" }] },
    { name: "Living areas", items: [{ label: "Walls" }, { label: "Floors" }, { label: "Smoke alarms" }] },
  ],
  Exit: [
    { name: "Entry / Exterior", items: [{ label: "Front door & locks" }, { label: "Yard / external" }, { label: "Keys returned" }] },
    { name: "Kitchen", items: [{ label: "Cleanliness" }, { label: "Appliances" }] },
    { name: "Bathroom", items: [{ label: "Cleanliness" }] },
    { name: "Living areas", items: [{ label: "Walls (damage)" }, { label: "Floors & carpet" }, { label: "Smoke alarms" }] },
  ],
};
