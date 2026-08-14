export type RentFrequency = "Weekly" | "Fortnightly" | "Monthly";
export type LeaseDuration = "6 Months" | "12 Months" | "Periodic";
export type RepaymentFrequency = "Weekly" | "Fortnightly" | "Monthly";

export interface Property {
  id: string;
  address: string;
  purchasePrice: number;
  currentValue: number;
  purchaseDate?: string;
  /** Optional short unique code tenants type into public maintenance form */
  tenantCode?: string;
  /** Display name shown instead of the raw address when set. */
  alias?: string;
  managerName?: string;
  managerPhone?: string;
  managerEmail?: string;
  /** Account references used for auto-matching inbound bills to this property. */
  councilRateRef?: string;
  waterAccountRef?: string;
  stampDuty?: number;
  deposit?: number;
  lotSize?: string;
  physicalAttributes?: string;
  // Optional inline "primary loan" metadata (used by the Housekeeping tab).
  lender?: string;
  loanAccountRef?: string;
  loanBalance?: number;
  interestRate?: number;
  repaymentFrequency?: RepaymentFrequency;
  // Annual running-cost budget figures, used across the property's finances.
  councilRatesAnnual?: number;
  waterRatesAnnual?: number;
  insuranceAnnual?: number;
  strataFeesAnnual?: number;
  landTaxAnnual?: number;
  repairsMaintenanceAnnual?: number;
  pmFeePercent?: number;
  notes?: string;
  photos?: { name: string; data: string }[];
  videos?: { name: string; data: string }[];
  // Premises-level disclosures required on a standard NSW residential tenancy agreement —
  // captured once per property, reused automatically for every future tenant.
  maxOccupants?: number;
  premisesInclusions?: string;
  smokeAlarmType?: "Hardwired" | "Battery";
  smokeAlarmBatteryReplaceable?: boolean;
  smokeAlarmBatteryType?: string;
  smokeAlarmBackupBatteryReplaceable?: boolean;
  smokeAlarmBackupBatteryType?: string;
  strataResponsibleForSmokeAlarms?: boolean;
  strataBylawsApply?: boolean;
  electricalRepairsContactName?: string;
  electricalRepairsContactPhone?: string;
  plumbingRepairsContactName?: string;
  plumbingRepairsContactPhone?: string;
  otherRepairsContactName?: string;
  otherRepairsContactPhone?: string;
  waterUsagePaidSeparately?: boolean;
  electricityEmbeddedNetwork?: boolean;
  gasEmbeddedNetwork?: boolean;
  hasSwimmingPool?: boolean;
}

export interface Tenant {
  id: string;
  name: string; // required
  rentAmount: number; // required
  rentFrequency: RentFrequency; // required
  email?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  /** Legacy free-text fallback */
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
  leaseDocumentFileData?: string;
  idProofFileName?: string;
  idProofFileData?: string;
  bondTransferFileName?: string;
  bondTransferFileData?: string;
  // Tenancy-specific lease terms (unlike premises disclosures on Property, these can genuinely
  // differ per tenancy at the same property).
  petsAllowed?: boolean;
  petsDescription?: string;
  additionalLeaseTerms?: string;
  /** Co-tenants beyond the primary `name` — the standard NSW form has slots for tenant 2 and 3. */
  additionalTenants?: ContactPerson[];
  bondPaidTo?: "Landlord" | "Agent" | "NSW Fair Trading";
  landlordConsentsToElectronicService?: boolean;
  tenantConsentsToElectronicService?: boolean;
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
  /** Days that this adjustment/payment shifts the paid-up-to date. Used to reverse cleanly on undo. */
  daysShift?: number;
  /** How this entry was posted — unset for historical rows predating this field. */
  source?: "manual" | "bank_feed" | "rent_statement";
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
  dueDayOfMonth?: number;
  isDirectDebit?: boolean;
  linkedBankAccount?: string;
  status?: "Active" | "Paid Off" | "In Arrears";
}

export interface Expense {
  id: string;
  itemName: string;
  cost: number;
  date: string;
  propertyId?: string;
  taxCategory: "Immediate Deduction" | "Capital Works";
  invoiceFileName?: string;
  invoiceFileData?: string;
  hasWarranty: boolean;
  warrantyExpiry?: string;
  rechargeToTenant: boolean;
  tenantId?: string;
  status: "needs_review" | "approved" | "paid";
  source: "manual" | "email_auto";
  bpayBillerCode?: string;
  bpayReference?: string;
  paidDate?: string;
  rawPropertyAddress?: string;
  emailMessageId?: string;
  reviewReason?: string | null;
  sourceSubject?: string;
  sourceEmailBody?: string;
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

/** A specific problem noted during/after an inspection — independent of the room checklist, so it can be logged directly off an uploaded third-party report. */
export interface InspectionIssue {
  id: string;
  description: string;
  photoData?: string;
  photoName?: string;
  status: "Open" | "Maintenance Logged" | "Resolved";
  maintenanceRequestId?: string;
  followUpNote?: string;
}

export interface Inspection {
  id: string;
  propertyId: string;
  /** The tenant in place at the time of this inspection — kept explicit so history stays correct across tenant changes. */
  tenantId?: string;
  date: string;
  type: "Entry" | "Routine" | "Exit";
  status: "Scheduled" | "Completed";
  notes?: string;
  fileFileName?: string;
  fileData?: string;
  checklist?: ChecklistItem[];
  rooms?: ChecklistRoom[];
  photos?: { name: string; data: string }[];
  signature?: string;
  issues?: InspectionIssue[];
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
  /** The lease document that was active during this past lease period, archived at renewal time. */
  leaseDocumentFileName?: string;
  leaseDocumentFileData?: string;
}

export interface MaintenanceRequest {
  id: string;
  propertyId?: string;
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
  /** Marks entries the landlord logged manually vs public form submissions */
  source?: "public" | "landlord";
}

export interface AiConfig {
  enabled: boolean;
  dailyCount: number;
  countDate: string;
  dailyLimit: number;
}

/** A co-landlord or co-tenant beyond the primary one — name plus optional contact details. */
export interface ContactPerson {
  name: string;
  email?: string;
  phone?: string;
}

export interface LandlordProfile {
  fullName: string;
  email: string;
  phone: string;
  notifyEmail: boolean;
  notifySms: boolean;
  /** Co-landlords/owners, reused as the default pool when generating a tenancy agreement. */
  additionalLandlords?: ContactPerson[];
}

export type LeaseTemplateFieldType = "text" | "checkbox" | "radio" | "dropdown";

export interface LeaseTemplateField {
  name: string;
  type: LeaseTemplateFieldType;
  /** Real option strings, for radio/dropdown fields. */
  options?: string[];
}

/**
 * A landlord-uploaded fillable lease agreement PDF (e.g. the official NSW Fair Trading standard
 * form), the last field-inspection result, and the saved mapping from our captured data points
 * to that PDF's actual field names — file-agnostic by design, no field name is ever hardcoded.
 */
export interface LeaseTemplateConfig {
  fileName: string;
  fileData: string;
  uploadedAt: string;
  fields: LeaseTemplateField[];
  /**
   * Most data points map onto a single PDF field (optionally translating our value to that
   * field's real option string via `valueMap`). Some official forms (e.g. NSW's standard
   * tenancy agreement) represent a single logical choice — lease term length, rent frequency,
   * smoke alarm type — as several independent checkboxes rather than one field. For those,
   * `isChoiceGroup: true` repurposes `valueMap` to point each of our values at the *name* of the
   * checkbox to tick for that value (all other checkboxes in the group are simply left
   * unchecked, since filling always starts from the pristine uploaded template).
   */
  mapping: Record<string, { pdfField: string; valueMap?: Record<string, string>; isChoiceGroup?: boolean }>;
}

export type BillType =
  | "Water"
  | "Council Rates"
  | "Strata"
  | "Insurance"
  | "Electricity"
  | "Gas"
  | "Other";

export interface PropertyBill {
  id: string;
  propertyId: string;
  billType: BillType;
  amount: number;
  dueDate: string;
  status: "Unpaid" | "Paid" | "Overdue";
  paidDate?: string;
  portalUrl?: string;
  portalUsername?: string;
  passwordNote?: string;
  notes?: string;
  /** If set, marking this bill Paid auto-creates the next cycle N months later. */
  recurrenceMonths?: number;
}

/** Extracted-but-unconfirmed lease details from an inbound rent/lease agreement. */
export interface TenantLeaseProposalPayload {
  name: string;
  email?: string;
  phone?: string;
  rentAmount: number;
  rentFrequency: RentFrequency;
  leaseStart?: string;
  leaseExpiry?: string;
  leaseDuration?: LeaseDuration;
  bondAmount?: number;
  confidence: number;
}

/** Extracted-but-unconfirmed rent payment transactions from an inbound agent statement. */
export interface RentLedgerProposalPayload {
  tenantName?: string;
  periodStart?: string;
  periodEnd?: string;
  transactions: { date: string; amount: number; description: string }[];
  confidence: number;
}

export interface AiIntakeProposal {
  id: string;
  kind: "tenant_lease" | "rent_ledger";
  status: "pending" | "applied" | "dismissed";
  propertyId?: string;
  matchedTenantId?: string;
  rawPropertyAddress?: string;
  sourceSubject?: string;
  emailMessageId?: string;
  sourceFileName?: string;
  sourceFileData?: string;
  sourceEmailBody?: string;
  payload: TenantLeaseProposalPayload | RentLedgerProposalPayload;
  reviewReason?: string | null;
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
  landlordProfile: LandlordProfile;
  bills: PropertyBill[];
  aiProposals: AiIntakeProposal[];
  leaseTemplate: LeaseTemplateConfig | null;
  /** The official Tenant Information Statement PDF, appended after the filled agreement on generation. */
  tenantInfoStatement: { fileName: string; fileData: string; uploadedAt: string } | null;
}

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
  Routine: ["Kitchen", "Bathroom", "Walls", "Floors", "Smoke alarms", "General cleanliness"],
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
    {
      name: "Living areas",
      items: [
        { label: "Walls & paint" },
        { label: "Floors & carpet" },
        { label: "Windows & screens" },
        { label: "Smoke alarms" },
      ],
    },
  ],
  Routine: [
    { name: "Kitchen", items: [{ label: "Cleanliness" }, { label: "Appliances working" }] },
    { name: "Bathroom", items: [{ label: "Cleanliness" }, { label: "Leaks / mould" }] },
    { name: "Living areas", items: [{ label: "Walls" }, { label: "Floors" }, { label: "Smoke alarms" }] },
  ],
  Exit: [
    {
      name: "Entry / Exterior",
      items: [{ label: "Front door & locks" }, { label: "Yard / external" }, { label: "Keys returned" }],
    },
    { name: "Kitchen", items: [{ label: "Cleanliness" }, { label: "Appliances" }] },
    { name: "Bathroom", items: [{ label: "Cleanliness" }] },
    {
      name: "Living areas",
      items: [{ label: "Walls (damage)" }, { label: "Floors & carpet" }, { label: "Smoke alarms" }],
    },
  ],
};
