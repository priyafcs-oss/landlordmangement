export type RentFrequency = "Weekly" | "Fortnightly" | "Monthly";
export type LeaseDuration = "6 Months" | "12 Months" | "Periodic";
export type RepaymentFrequency = "Weekly" | "Fortnightly" | "Monthly";

/** ATO-aligned expense category taxonomy, grouped by tax treatment. Running Expenses are the
 * only group claimable as an immediate deduction in the year incurred — Depreciation lines are
 * informational (the real depreciation schedule lives in DepreciationItem), Cost Base (Capital)
 * items add to the property's cost base for a future CGT calculation rather than reducing this
 * year's taxable income, and Non-Deductible items (private-use travel, loan principal) are
 * tracked as spending but never claimed. See categoryGroupOf/expenseCategoryToTaxCategory in
 * calculations.ts for how a chosen category maps onto the coarser two-value taxCategory field. */
export const CATEGORY_GROUPS = {
  "Running Expenses": [
    "Advertising for Tenants",
    "Body Corporate Fees",
    "Borrowing Expenses",
    "Cleaning",
    "Council Rates",
    "Gardening / Lawn Mowing",
    "Insurance",
    "Interest on Loan",
    "Land Tax",
    "Legal Fees",
    "Pest Control",
    "Property Agent Fees",
    "Repairs & Maintenance",
    "Strata Levies",
    "Water Charges",
    "Electricity",
    "Gas",
    "Telephone / Internet",
    "Tax Agent / Accounting Fees",
    "Letting Fees",
    "Sundry Rental Expenses",
  ],
  Depreciation: ["Depreciation - Plant & Equipment (Div 40)", "Capital Works Deduction (Div 43)"],
  "Cost Base (Capital)": [
    "Purchase Cost",
    "Capital Improvement",
    "Initial Repairs (Capital)",
    "Stamp Duty",
    "Conveyancer Fees",
    "Conveyancing / Legal (Purchase)",
    "Buyer's Agent Fee",
    "Building / Pest Inspection (Purchase)",
    "Selling Agent's Commission",
    "Selling Costs (Marketing / Auction / Staging)",
  ],
  "Non-Deductible": ["Travel Expenses", "Loan Principal Repayment", "Other Expense"],
} as const;
export type CategoryGroup = keyof typeof CATEGORY_GROUPS;
export type ExpenseCategory = (typeof CATEGORY_GROUPS)[CategoryGroup][number];
export const EXPENSE_CATEGORIES = Object.values(CATEGORY_GROUPS).flat() as ExpenseCategory[];

/** Categories for an Expense row with direction: "Income" — a separate list from ExpenseCategory
 * since none of the ATO expense/deduction taxonomy above applies to money coming in. "Other Rental
 * Income" is the catch-all for anything recharged/reimbursed by a tenant outside the rent itself
 * (e.g. a water-usage reimbursement) that isn't worth its own category. */
export const INCOME_CATEGORIES = ["Gross Rent", "Other Rental Income", "Bond Claimed", "Sale Proceeds (Capital)"] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
/** Which group a category belongs to — undefined for a legacy/unrecognised value (e.g. an
 * expense saved before this taxonomy existed). */
export function categoryGroupOf(category?: string | null): CategoryGroup | undefined {
  for (const [group, items] of Object.entries(CATEGORY_GROUPS)) {
    if ((items as readonly string[]).includes(category ?? "")) return group as CategoryGroup;
  }
  return undefined;
}

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
  /** Set once the property has been sold — mirrors the Asset's "Sold" status. Simplified disposal
   * record (sale price, date, selling costs) for reference, not a full CGT calculation. */
  saleDate?: string;
  salePrice?: number;
  sellingCosts?: number;
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
  /** How often this property should be routinely inspected. Unset falls back to the app default (6 months). */
  inspectionFrequencyMonths?: number;
  /** Ownership structure this property is held under (individual/joint/trust/SMSF/company). */
  entityId?: string;
  occupancyType?: "Investment" | "PPOR";
  /** Mirror row in the generic `assets` register — kept in sync by the store, not a separate source of truth. */
  assetId?: string;
  strataLevyAmount?: number;
  strataLevyFrequency?: "Quarterly" | "Annually";
  insurerName?: string;
  insurancePolicyNumber?: string;
  insurancePremium?: number;
  insuranceRenewalDate?: string;
  insuranceSumInsured?: number;
  smokeAlarmCheckDueDate?: string;
  poolSafetyCertExpiry?: string;
  electricalSafetyCertExpiry?: string;
  gasSafetyCertExpiry?: string;
  // Domain API-fillable property attributes (also editable by hand).
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSizeSqm?: number;
  /** Domain's own category, e.g. "House" | "Townhouse" | "Unit" — distinct from dwellingConfiguration below. */
  domainPropertyType?: string;
  /** One title holding more than one dwelling (a house + granny flat, or a genuine dual-key build).
   * Purchase price/loan/cost base stay on this one Property record either way — only `units` below
   * changes, giving each dwelling its own address/bedroom count for tenant-facing purposes. */
  dwellingConfiguration?: "House" | "Dual Key" | "House + Granny Flat";
  units?: PropertyUnit[];
}

/** One dwelling on a multi-dwelling title — see Property.dwellingConfiguration/units. Its own
 * tenancy, rent, managing agent and expenses scope to this `id` via Tenant/Provider/Expense/
 * PropertyBill.unitId; whole-property shared costs (council rates, land tax, building insurance)
 * simply never set a unitId, they aren't artificially split across units. */
export interface PropertyUnit {
  id: string;
  label: string;
  address?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  notes?: string;
}

/**
 * A simplified depreciation line for a property — NOT a full ATO Div 40/43 engine (no low-value
 * pooling, no part-year private-use apportionment beyond first-year day-counting, no pre-2017 150%
 * diminishing-value rate). Prime Cost annual claim = purchaseCost / effectiveLifeYears; Diminishing
 * Value uses a standard 200%-declining-balance projection — see buildDepreciationSchedule.
 */
export interface DepreciationItem {
  id: string;
  assetId: string;
  description: string;
  purchaseCost: number;
  effectiveLifeYears: number;
  purchaseDate?: string;
  method?: "Diminishing Value" | "Prime Cost";
  division?: "Div 40" | "Div 43";
  /** Items added together via one "Add depreciation report" upload share one id — same
   * denormalized-grouping pattern as PropertyBill.billGroupId, no separate report table. */
  reportId?: string;
  quantitySurveyor?: string;
  reportReference?: string;
  reportDate?: string;
  effectiveFrom?: string;
  sourceFileName?: string;
  sourceFileData?: string;
}

/** One point-in-time value for an asset — captured automatically whenever currentValue changes,
 * building real history forward from today rather than any backfilled guess. */
export interface ValuationSnapshot {
  id: string;
  assetId: string;
  date: string;
  value: number;
}

export interface LoanBalanceSnapshot {
  id: string;
  loanId: string;
  date: string;
  balance: number;
}

/**
 * A cash-reserve target. currentBalance is entered manually by the landlord — there's no
 * "Cash Account" asset type yet, so this deliberately doesn't try to link to one; it's just a
 * number you keep updated, checked against a target (a flat amount or N months of expenses).
 */
export type BufferScopeType = "Portfolio" | "Entity" | "Asset";

export interface CashBuffer {
  id: string;
  scopeType: BufferScopeType;
  scopeId?: string;
  label: string;
  targetAmount?: number;
  targetMonths?: number;
  currentBalance: number;
}

export interface Tenant {
  id: string;
  /** Server-set on insert — when this tenant record was created, used by Documents to show
   * "date added" separately from lease/business dates. */
  created_at?: string;
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
  /** Overrides the property's own address on everything this tenant sees (ledger, lease, invoices,
   * tenant portal) — for a title with multiple dwellings (e.g. a house + granny flat sharing one
   * Property record for purchase price/loan/cost base) where each tenant needs a distinct address. */
  unitAddress?: string;
  /** Which PropertyUnit (dwelling) this tenancy is in, when the property has more than one —
   * the authoritative link Transactions/Documents scope by, distinct from the free-text
   * `unitAddress` display override above. Unset on a single-dwelling property. */
  unitId?: string;
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
  /** The statement/document this payment was read off, when there is one (set for
   * source: "rent_statement" rows) — lets Transactions link straight back to it. */
  sourceFileName?: string;
  sourceFileData?: string;
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
  /** Cash sitting in an offset account against this loan — reduces the interest it accrues. */
  offsetBalance?: number;
  /** Which Asset this loan is secured against/funds — mirrors propertyId, set for every asset type. */
  assetId?: string;
}

export interface Expense {
  id: string;
  /** Server-set on insert — when this expense was actually recorded, distinct from its business
   * `date`. Used by Documents to show "date added". */
  created_at?: string;
  itemName: string;
  cost: number;
  date: string;
  propertyId?: string;
  /** Which Asset this transaction belongs to — set for every asset type, propertyId only for Property. */
  assetId?: string;
  /** Which PropertyUnit (dwelling) this expense is directly attributable to, on a multi-dwelling
   * property — e.g. a granny flat's own repair, or a separately metered unit's utility bill.
   * Unset means a whole-property shared cost (council rates, land tax, building insurance) —
   * never inferred/split automatically, only ever set when the landlord explicitly files it to
   * one dwelling. */
  unitId?: string;
  /** Unset means "Expense" — every historical row is an outgoing. Only Income exists for
   * non-property assets (a gold sale, an ETF dividend) where cost alone can't say which way
   * the money moved; Property expenses never set this. */
  direction?: "Income" | "Expense";
  taxCategory: "Immediate Deduction" | "Capital Works";
  /** The spending category picked at entry time (e.g. "Repairs & Maintenance") — kept alongside
   * taxCategory so Documents can tell a maintenance invoice apart from a management fee. An
   * IncomeCategory value only appears when direction === "Income" (taxCategory is meaningless for
   * those rows and left at its default). */
  category?: ExpenseCategory | IncomeCategory;
  /** Vendor/payee this transaction was paid to (expenses) or received from (income) — e.g. the
   * tradesperson on a repair, the agent/tenant a rent line came from. Free text, separate from the
   * Provider directory (a transaction doesn't have to match a saved Provider record). */
  providerName?: string;
  /** Set when providerName was matched (or manually linked) to a directory Provider — lets
   * payment history/outstanding-invoices roll up on the provider's profile page. */
  providerId?: string;
  /** GST component of `cost`, when known — entered per-line-item on manual transactions. Absent
   * (not zero) for rows where GST was never captured, so a Transactions GST total can tell "no GST
   * on this line" apart from "GST unknown/not entered". */
  gst?: number;
  invoiceFileName?: string;
  invoiceFileData?: string;
  hasWarranty: boolean;
  warrantyExpiry?: string;
  rechargeToTenant: boolean;
  tenantId?: string;
  /** Set once a TenantInvoice has actually been created for the recharge, so re-saving never double-charges. */
  recharged?: boolean;
  status: "needs_review" | "approved" | "paid";
  source: "manual" | "email_auto" | "upload";
  bpayBillerCode?: string;
  bpayReference?: string;
  referenceNumber?: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string;
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
  created_at?: string;
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
  created_at?: string;
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

export type ProviderRole = "Council" | "Agent" | "Insurer" | "Trade" | "Other";

export type FeeFrequency = "Per Statement" | "Monthly" | "Quarterly" | "Annually";

/** A vendor/contact — council, managing agent, insurer, tradesperson, etc. Portfolio-wide identity
 * only (name, contact details, ABN); per-property management-agreement fee terms live on
 * `ProviderAgreement` instead (see that type) so the same real-world agency can hold different
 * terms at different properties without duplicating its identity row. `propertyId` is kept only
 * because the underlying DB column still exists for legacy rows written before that split — new
 * code must not read or write it; use `ProviderProperty`/`ProviderAgreement` instead. */
export interface Provider {
  id: string;
  created_at?: string;
  /** @deprecated Legacy single-property scoping, predating the provider/agreement split — left on
   * old rows for reference only. New code links a provider to a property via `ProviderProperty`. */
  propertyId?: string;
  /** Which PropertyUnit (dwelling) this contact belongs to — lets one dwelling on a multi-unit
   * property have its own managing agent distinct from the whole property's. Unset means it
   * applies property-wide (the common case, and every contact on a single-dwelling property). */
  unitId?: string;
  name: string;
  role: ProviderRole;
  email?: string;
  phone?: string;
  website?: string;
  abn?: string;
  address?: string;
  notes?: string;
  portalUrl?: string;
  portalUsername?: string;
  passwordNote?: string;
  /** The ATO category most often confirmed on bills/expenses from this provider — suggested (not
   * forced) on future bills that resolve to this provider via provider-match.ts, the same way a
   * council's bills are always "Council Rates". */
  defaultCategory?: ExpenseCategory;
}

/** A property a provider is associated with — a lightweight tag, separate from any formal
 * agreement, so a contact that doesn't have (or doesn't need) fee terms on file — a plumber, an
 * insurer, a council — still shows up on that property's Providers tab. Auto-created whenever a
 * `ProviderAgreement` is added for the same (providerId, propertyId) pair, or when the landlord
 * explicitly adds an existing portfolio provider to a property. */
export interface ProviderProperty {
  id: string;
  created_at?: string;
  providerId: string;
  propertyId: string;
}

/** One property's signed Property Management Agreement with one provider — the fee terms and
 * contract file that used to live directly on `Provider`, now scoped per (providerId, propertyId)
 * so the same agency can hold different terms at different properties. Multiple rows can exist for
 * the same pair over time (a renewed agreement); callers pick the most recent by
 * `contractStartDate` when they need "the current one". Only meaningful when the provider's
 * `role === "Agent"`. */
export interface ProviderAgreement {
  id: string;
  created_at?: string;
  providerId: string;
  propertyId: string;
  /** The signed Property Management Agreement file itself, kept alongside the fee terms read off
   * it so a rent statement's agent deductions can be checked against what was actually agreed —
   * the same pairing pattern as every other extracted document in this app (source file + the
   * fields read off it). */
  contractFileName?: string;
  contractFileData?: string;
  /** Ongoing management fee, as a % of rent collected each period. */
  managementFeePercent?: number;
  /** One-off fee when a new tenant is placed — either a flat amount, or expressed as a number of
   * weeks' rent (only one is normally set; if both are, the flat amount wins). */
  lettingFeeAmount?: number;
  lettingFeeWeeksRent?: number;
  /** Flat fee charged alongside the % management fee, separate from it. */
  adminFeeAmount?: number;
  adminFeeFrequency?: FeeFrequency;
  leaseRenewalFeeAmount?: number;
  /** Fee charged per routine/entry/exit inspection, if billed separately. */
  inspectionFeeAmount?: number;
  /** Marketing/advertising fee charged when a property is listed for a new tenant — flat amount,
   * separate from the letting fee itself. */
  advertisingFeeAmount?: number;
  /** One-off fee for preparing a new lease, separate from the letting fee itself. */
  leasePreparationFeeAmount?: number;
  /** Fee for attending/lodging an NCAT (or other tribunal) matter on the owner's behalf. */
  ncatFeeAmount?: number;
  /** How many routine inspections per year the agreement commits the agent to — a count, distinct
   * from `inspectionFeeAmount` (the $ charged per inspection, if billed separately). */
  inspectionsPerYear?: number;
  /** Notice period (in days) either side must give to end the agreement, as stated in the
   * agreement's termination clause. */
  noticePeriodDays?: number;
  contractStartDate?: string;
  /** When the agreement is next up for renewal/review, if stated. */
  contractReviewDate?: string;
  contractNotes?: string;
  /** Master "is this agency GST-registered" switch — when false, no fee has GST added regardless
   * of the per-fee flags below. When true, each fee's effective/expected amount in
   * feeVerification.ts is `rate * 1.1`, UNLESS that fee's own `*GstInclusive` flag is set, in which
   * case the stated rate already has GST folded in and is used as-is. Per-fee rather than one
   * global multiplier because a single agreement can state some fees as "X% plus GST" and others
   * as "$Y inclusive of GST" — a single flag can't represent both without double- or under-counting. */
  gstApplicable: boolean;
  managementFeeGstInclusive?: boolean;
  lettingFeeGstInclusive?: boolean;
  adminFeeGstInclusive?: boolean;
  leaseRenewalFeeGstInclusive?: boolean;
  inspectionFeeGstInclusive?: boolean;
  advertisingFeeGstInclusive?: boolean;
  leasePreparationFeeGstInclusive?: boolean;
  ncatFeeGstInclusive?: boolean;
  /** Whether the agent pays this outgoing from rental proceeds on the owner's behalf, per the
   * agreement's terms — distinct from Property's own waterRatesAnnual/landTaxAnnual/
   * councilRatesAnnual, which just record the amounts, not who actually pays them. */
  agentPaysWaterUsage?: boolean;
  agentPaysLandTax?: boolean;
  agentPaysCouncilRates?: boolean;
}

/** A document held against a Provider directory record rather than a specific property — a
 * certificate of currency, trade licence, or similar — badged with the same expiry-soon
 * treatment as InsurancePolicy/ComplianceCertificate. */
export interface ProviderDocument {
  id: string;
  created_at?: string;
  providerId: string;
  docType?: string;
  fileName?: string;
  fileData?: string;
  expiryDate?: string;
}

export type EntityType = "Individual" | "Joint" | "Trust" | "SMSF" | "Company";

/** One owner's share of an entity — e.g. a Joint entity has two owners with a percent split. */
export interface EntityOwner {
  name: string;
  percent: number;
}

/** An ownership structure a property can be held under — individual name, joint, a trust, an SMSF, etc. */
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  owners: EntityOwner[];
  notes?: string;
}

/**
 * Every current asset type. Property is the only one with its own full screen set (see
 * PropertyDrawer in portfolio.tsx) — Gold and ETF get the generic Overview/Transactions/
 * Bills/Documents/Notes tabs on the Assets page. Adding a new type later is one more union
 * member plus one small `*_details` extension table — nothing here or in Transactions/Bills/
 * Loans/Documents needs to change.
 */
export type AssetType = "Property" | "Gold" | "ETF";

/**
 * The generic register every asset — of any type — has a row in. For Property, this is a
 * lightweight mirror kept in sync by the store's addProperty/updateProperty/deleteProperty
 * actions; `properties` stays the source of truth for property-specific fields. For Gold/ETF,
 * this row IS the source of truth, alongside its `*_details` extension row.
 */
export interface Asset {
  id: string;
  assetType: AssetType;
  name: string;
  ownerEntityId?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  currentValue: number;
  valuationDate?: string;
  status: "Active" | "Archived" | "Sold";
  tags?: string[];
  notes?: string;
  /** Set only when assetType === "Property" — back-reference to the properties row this mirrors. */
  linkedPropertyId?: string;
}

export interface GoldDetails {
  assetId: string;
  form?: "Bar" | "Coin" | "Other";
  gramsHeld?: number;
  storageLocation?: string;
}

export interface EtfDetails {
  assetId: string;
  ticker?: string;
  exchange?: string;
  unitsHeld?: number;
  avgCostPerUnit?: number;
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

/** One cost line on a bill — e.g. a council notice broken into rates/waste/environment charges. */
export interface BillLineItem {
  description: string;
  category?: string;
  amount: number;
  gst?: number;
  rechargeToTenant?: boolean;
  tenantId?: string;
  /** Set once a TenantInvoice has actually been created for this item, so re-saving never double-charges. */
  recharged?: boolean;
}

export interface PropertyBill {
  id: string;
  propertyId?: string;
  /** Which Asset this bill belongs to — set for every asset type, propertyId only for Property. */
  assetId?: string;
  /** Which PropertyUnit (dwelling) this bill is directly attributable to — see Expense.unitId.
   * Unset means whole-property shared (the common case: council rates, land tax, insurance). */
  unitId?: string;
  billType: BillType;
  amount: number;
  dueDate: string;
  status: "Unpaid" | "Paid" | "Overdue";
  paidDate?: string;
  /** @deprecated portal login now lives on the Provider record — kept for bills saved before that move. */
  portalUrl?: string;
  /** @deprecated see portalUrl. */
  portalUsername?: string;
  /** @deprecated see portalUrl. */
  passwordNote?: string;
  notes?: string;
  /** If set, marking this bill Paid auto-creates the next cycle N months later. */
  recurrenceMonths?: number;
  /** Shared across every instalment row created from one notice/one Add Bill submission. */
  billGroupId?: string;
  /** e.g. "Instalment 2" — set when this row is one of several sharing a billGroupId. */
  label?: string;
  providerName?: string;
  /** Set when providerName was matched (or manually linked) to a directory Provider — see
   * Expense.providerId. */
  providerId?: string;
  referenceNumber?: string;
  bpayBillerCode?: string;
  bpayReference?: string;
  issueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  lineItems?: BillLineItem[];
  sourceFileName?: string;
  sourceFileData?: string;
  /** Set once this bill is marked Paid and its linked Expense is created — bills no longer get
   * a paired Expense at intake, only at payment time (markBillPaid), regardless of source. */
  linkedExpenseId?: string;
  /** How this bill entered the system — shown as a small badge so a landlord can tell an
   * AI-read bill apart from one they typed in by hand. */
  source?: "Manual" | "Upload" | "Email";
  /** Carried forward from intake (AI-classified atoCategory, or picked in the manual form) so
   * markBillPaid can post the linked Expense with the correct tax treatment instead of guessing.
   * Absent on bills created before this field existed — markBillPaid falls back to "Immediate
   * Deduction" for those. */
  taxCategory?: "Immediate Deduction" | "Capital Works";
  /** The specific ATO category picked at entry time (e.g. "Water Charges", "Capital Improvement")
   * — kept alongside taxCategory the same way Expense.category is, and drives it via
   * expenseCategoryToTaxCategory. Absent on bills saved before this field existed. */
  category?: ExpenseCategory;
  /** Set for bills created via the email/upload pipeline — lets a retried webhook be recognized
   * as already-processed even though (unlike before) no paired Expense exists to check instead. */
  emailMessageId?: string;
  /** Set to "pending" when a Water bill auto-approves (no more forced review just to see the
   * recharge decision) — cleared to "resolved" once the landlord has looked at it via
   * BillDetailDialog. Absent for every other bill type. */
  tenantRebillStatus?: "pending" | "resolved";
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
  /** tenantName here is per-line, set only on a changeover statement where this specific payment
   * is clearly attributable to a named tenant distinct from the statement's overall tenantName. */
  transactions: { date: string; amount: number; description: string; tenantName?: string }[];
  /** Expense lines on the same statement (e.g. an agent's management fee or a bill paid on the owner's behalf) — staged for review like everything else from this pipeline, never auto-applied. */
  expenseLines?: { vendor: string; amount: number; date: string; description: string; category: string }[];
  /** Rent income minus expense lines, for a quick "does this match the stated net-to-owner" sanity check. */
  netToOwner?: number;
  /** Balance the agent holds, carried between statements — when set, netToOwner is expected to
   * equal (income - expenseLines) + openingBalance - closingBalance, not period activity alone. */
  openingBalance?: number;
  closingBalance?: number;
  confidence: number;
}

/**
 * Extracted from a settlement statement, insurance certificate/policy, or strata notice — every
 * field but documentCategory/confidence is optional since one document rarely carries all of
 * them. The review card lets the landlord pick which fields to actually apply to the property.
 */
export interface PropertyDetailProposalPayload {
  documentCategory: string;
  purchaseDate?: string;
  purchasePrice?: number;
  stampDuty?: number;
  deposit?: number;
  ownerName?: string;
  ownershipType?: string;
  insurerName?: string;
  insurancePolicyNumber?: string;
  insurancePremium?: number;
  insuranceRenewalDate?: string;
  insuranceSumInsured?: number;
  strataLevyAmount?: number;
  strataLevyFrequency?: "Quarterly" | "Annually";
  smokeAlarmCheckDueDate?: string;
  poolSafetyCertExpiry?: string;
  electricalSafetyCertExpiry?: string;
  gasSafetyCertExpiry?: string;
  /** Settlement-adjustment line items from a PEXA record/Statement of Adjustments (council/water
   * rate adjustments, registration fees) — reviewed as a checklist, each becomes a Capital Works
   * expense against the property rather than a flat field, since there can be several. */
  settlementAdjustments?: { description: string; amount: number }[];
  confidence: number;
}

/** Extracted-but-unconfirmed line items from a forwarded quantity surveyor's depreciation schedule. */
export interface DepreciationReportProposalPayload {
  quantitySurveyor?: string;
  reportReference?: string;
  reportDate?: string;
  effectiveFrom?: string;
  items: { description: string; division: "Div 40" | "Div 43"; cost: number; lifeYears?: number }[];
  confidence: number;
}

/** A document Gemini couldn't classify into any known type — staged so it's never silently dropped. */
export interface UnclassifiedProposalPayload {
  documentCategory: string;
  confidence: number;
}

/** Extracted from an initial loan/mortgage document — a new Loan, staged for confirmation. */
export interface LoanDocumentProposalPayload {
  lenderName: string;
  loanAmount?: number;
  interestRate?: number;
  monthlyRepayment?: number;
  startDate?: string;
  hasOffsetAccount?: boolean;
  confidence: number;
}

/** Extracted from an ongoing loan statement — matched against an existing Loan to update, not create. */
export interface LoanStatementProposalPayload {
  lenderName: string;
  periodStart?: string;
  periodEnd?: string;
  interestCharged?: number;
  repaymentsMade?: number;
  closingBalance?: number;
  confidence: number;
}

/** A general bank statement (not an agent rent statement) — every line reviewed individually since
 * a personal account can mix multiple properties, or entirely unrelated spending. */
export interface BankStatementProposalPayload {
  bankName?: string;
  periodStart?: string;
  periodEnd?: string;
  transactions: {
    date: string;
    description: string;
    amount: number;
    direction: "in" | "out";
    /** Set when this line's description matched an existing Provider directory record. */
    providerId?: string;
    /** Set instead of providerId when no directory match was found, so the review UI can still
     * show a suggested vendor name (usually the cleaned-up description) for this line. */
    suggestedProviderName?: string;
  }[];
  confidence: number;
}

/** A Contract of Sale (on disposal) or settlement statement on sale — marks the property Sold. */
export interface PropertySaleProposalPayload {
  saleDate?: string;
  salePrice?: number;
  sellingCosts?: number;
  buyerName?: string;
  confidence: number;
}

/** A bill flagged by guardrails (duplicate/price-spike/low-confidence/unmatched property, or any
 * Water bill — see reviewReason) instead of posting straight to expenses. Mirrors ParsedBillFields
 * minus vendor/property_address, which live on the shared envelope (providerName/rawPropertyAddress). */
export interface BillProposalPayload {
  amount: number;
  dueDate: string;
  bpayBillerCode?: string;
  bpayReference?: string;
  atoCategory: "Immediate Deduction" | "Capital Works";
  billCategory: BillType;
  futureInstalments?: { dueDate: string; amount: number }[];
  lineItems: BillLineItem[];
  vendorEmail?: string;
  vendorPhone?: string;
  vendorWebsite?: string;
  vendorAbn?: string;
  vendorAddress?: string;
  /** Set when the extracted vendor matched an existing Provider directory record — see
   * provider-match.ts. Resolving to an existing provider happens on both the approved and staged
   * paths; only auto-approved bills may CREATE a brand-new provider row. */
  providerId?: string;
  /** Prefilled from the matched provider's defaultCategory when the bill's own extraction didn't
   * confidently determine one. */
  category?: ExpenseCategory;
  confidence: number;
}

/** A manually-entered one-off transaction flagged by the same duplicate/price-spike guardrails
 * bills use, checked client-side against state.expenses at save time. Mirrors the fields
 * ExpenseDialog already collects. */
export interface ExpenseProposalPayload {
  itemName: string;
  cost: number;
  date: string;
  taxCategory: "Immediate Deduction" | "Capital Works";
  hasWarranty?: boolean;
  warrantyExpiry?: string;
  rechargeToTenant?: boolean;
  tenantId?: string;
}

export interface AiIntakeProposal {
  id: string;
  /** Server-set on insert — when this document was received, used for the Documents archive. */
  created_at?: string;
  kind:
    | "bill"
    | "expense"
    | "tenant_lease"
    | "rent_ledger"
    | "property_detail"
    | "depreciation_report"
    | "unclassified"
    | "loan_document"
    | "loan_statement"
    | "bank_statement"
    | "property_sale"
    | "agency_agreement";
  status: "pending" | "applied" | "dismissed";
  propertyId?: string;
  matchedTenantId?: string;
  /** loan_statement only — set when exactly one loan on the matched property shares the extracted lender name. */
  matchedLoanId?: string;
  rawPropertyAddress?: string;
  sourceSubject?: string;
  emailMessageId?: string;
  sourceFileName?: string;
  sourceFileData?: string;
  sourceEmailBody?: string;
  /** Common header fields shown across every kind — populated where realistically extractable/known;
   * "—" in the UI when absent. See DocumentReviewCard. */
  documentDate?: string;
  providerName?: string;
  addressedTo?: string;
  payload:
    | BillProposalPayload
    | ExpenseProposalPayload
    | TenantLeaseProposalPayload
    | RentLedgerProposalPayload
    | PropertyDetailProposalPayload
    | DepreciationReportProposalPayload
    | UnclassifiedProposalPayload
    | LoanDocumentProposalPayload
    | LoanStatementProposalPayload
    | BankStatementProposalPayload
    | PropertySaleProposalPayload
    | AgencyAgreementProposalPayload;
  reviewReason?: string | null;
}

/** Extracted terms from a signed Property Management Agreement (PMA), staged for review before
 * being applied onto the property's Agent Provider record — same shape as ProviderDialog's own
 * "Upload & extract" fields (src/components/PropertyShared.tsx), just arriving via the inbox or
 * a direct document upload instead. */
export interface AgencyAgreementProposalPayload {
  agencyName?: string;
  managementFeePercent?: number;
  managementFeeGstInclusive?: boolean;
  lettingFeeAmount?: number;
  lettingFeeWeeksRent?: number;
  lettingFeeGstInclusive?: boolean;
  adminFeeAmount?: number;
  adminFeeFrequency?: FeeFrequency;
  adminFeeGstInclusive?: boolean;
  leaseRenewalFeeAmount?: number;
  leaseRenewalFeeGstInclusive?: boolean;
  inspectionFeeAmount?: number;
  inspectionFeeGstInclusive?: boolean;
  advertisingFeeAmount?: number;
  advertisingFeeGstInclusive?: boolean;
  leasePreparationFeeAmount?: number;
  leasePreparationFeeGstInclusive?: boolean;
  ncatFeeAmount?: number;
  ncatFeeGstInclusive?: boolean;
  inspectionsPerYear?: number;
  agentPaysWaterUsage?: boolean;
  agentPaysLandTax?: boolean;
  agentPaysCouncilRates?: boolean;
  noticePeriodDays?: number;
  contractStartDate?: string;
  contractReviewDate?: string;
  confidence: number;
}

/** One past EOFY report generation, kept for quick reference — not the report itself, just a pointer to when/what. */
export interface ReportHistoryEntry {
  fy: string;
  scopeLabel: string;
  generatedAt: string;
}

/** A trail of every email the forwarding inbox has ever received, written server-side by
 * parse-inbound-bill/index.ts regardless of outcome — unlike AiIntakeProposal, which only gets a
 * row when classification/extraction actually succeeds. Lets a landlord see a bill they forwarded
 * that silently failed to parse, not just the ones that made it through. */
export interface EmailInboxLogEntry {
  id: string;
  created_at?: string;
  emailId?: string;
  fromAddress?: string;
  subject?: string;
  hasAttachment: boolean;
  attachmentFileName?: string;
  status: "processed" | "staged" | "skipped" | "failed";
  documentType?: string;
  proposalId?: string;
  billId?: string;
  errorMessage?: string;
}

export interface AppState {
  properties: Property[];
  tenants: Tenant[];
  providers: Provider[];
  providerAgreements: ProviderAgreement[];
  providerProperties: ProviderProperty[];
  entities: Entity[];
  assets: Asset[];
  goldDetails: GoldDetails[];
  etfDetails: EtfDetails[];
  depreciationItems: DepreciationItem[];
  valuationSnapshots: ValuationSnapshot[];
  loanBalanceSnapshots: LoanBalanceSnapshot[];
  buffers: CashBuffer[];
  ledger: LedgerEntry[];
  invoices: TenantInvoice[];
  loans: Loan[];
  expenses: Expense[];
  inspections: Inspection[];
  rentChanges: RentChange[];
  leaseHistory: LeaseHistory[];
  maintenanceRequests: MaintenanceRequest[];
  insurancePolicies: InsurancePolicy[];
  maintenanceItems: MaintenanceItem[];
  complianceCertificates: ComplianceCertificate[];
  propertyNotes: PropertyNote[];
  providerDocuments: ProviderDocument[];
  aiConfig: AiConfig;
  landlordProfile: LandlordProfile;
  bills: PropertyBill[];
  aiProposals: AiIntakeProposal[];
  emailInboxLog: EmailInboxLogEntry[];
  leaseTemplate: LeaseTemplateConfig | null;
  /** The official Tenant Information Statement PDF, appended after the filled agreement on generation. */
  tenantInfoStatement: { fileName: string; fileData: string; uploadedAt: string } | null;
  reportHistory: ReportHistoryEntry[];
}

export type InsuranceCoverType = "Landlord" | "Building" | "Contents" | "Public Liability" | "Strata" | "Professional Indemnity";
export type InsuranceDocumentType = "Policy Schedule / Renewal" | "Certificate of Currency" | "Product Disclosure / Supporting Document";

/** One insurance policy on a property — a property can hold more than one at once (e.g. landlord
 * insurance + a separate strata policy), and a renewal replaces a prior one rather than editing it
 * in place, so the history of premiums/cover over time is kept. */
export interface InsurancePolicy {
  id: string;
  created_at?: string;
  propertyId: string;
  unitId?: string;
  insurer: string;
  coverTypes: InsuranceCoverType[];
  policyNumber?: string;
  coverStart?: string;
  coverEnd?: string;
  premium?: number;
  premiumFrequency?: "Annual" | "Monthly" | "Quarterly";
  sumInsured?: number;
  excess?: number;
  coverageSummary?: string;
  documentType?: InsuranceDocumentType;
  /** The prior policy this one renews/replaces, if any — lets the renewal chain for one policy be followed back through time. */
  replacesPolicyId?: string;
  isSeparatePolicy?: boolean;
  fileName?: string;
  fileData?: string;
}

export type MaintenanceItemType = "Repair" | "Major Work";
export type MaintenancePriority = "Low" | "Normal" | "High" | "Urgent";
export type MaintenanceProjectType = "Renovation" | "Major Works" | "New Build" | "Granny Flat" | "Repair Project" | "Other";
export type MaintenanceStatus = "New" | "Scheduled" | "In Progress" | "Completed" | "On Hold" | "Cancelled";

/** A landlord-tracked job on a property — either a small Repair (a single trade visit) or a
 * Major Work (a multi-stage project with its own budget/schedule). Distinct from
 * MaintenanceRequest, which is the tenant/public-facing intake form; this is the landlord's own
 * work tracker, created directly rather than converted from a submitted request. */
export interface MaintenanceItem {
  id: string;
  created_at?: string;
  propertyId: string;
  unitId?: string;
  itemType: MaintenanceItemType;
  title: string;
  description?: string;
  /** Repair only. */
  priority?: MaintenancePriority;
  tradeCategory?: string;
  /** Major Work only. */
  projectType?: MaintenanceProjectType;
  status: MaintenanceStatus;
  scheduledDate?: string;
  startDate?: string;
  completedDate?: string;
  /** Repair: the actual/out-of-pocket cost. Major Work: use `budget` instead. */
  cost?: number;
  /** Major Work: the estimated cost/budget. */
  budget?: number;
  progressNotes?: string;
  contractorName?: string;
  contractorEmail?: string;
  contractorPhone?: string;
  /** Optional link to a Provider directory record for this job's tradesperson/contractor —
   * additive alongside the free-text contractorName, which stays the primary field. */
  providerId?: string;
  photos: { name: string; data: string }[];
  sourceFileName?: string;
  sourceFileData?: string;
}

export const COMPLIANCE_CERT_TYPES = [
  "Smoke Alarm",
  "Electrical Safety (RCD)",
  "Gas Safety",
  "Pool Safety / Barrier",
  "Energy Efficiency",
  "Asbestos",
  "Termite",
  "Building Compliance",
  "Fire Safety",
  "Lift Certification",
  "Backflow Prevention",
  "Essential Services",
] as const;
export type ComplianceCertType = (typeof COMPLIANCE_CERT_TYPES)[number];

/** One compliance certificate/inspection result on a property — a property accumulates one row
 * per check performed over time (this year's smoke alarm check, last year's), rather than a
 * single "next due date" field per cert type. */
export interface ComplianceCertificate {
  id: string;
  created_at?: string;
  propertyId: string;
  certType: ComplianceCertType | string;
  issuer?: string;
  referenceNumber?: string;
  notes?: string;
  issueDate?: string;
  expiryDate?: string;
  fileName?: string;
  fileData?: string;
}

/** A free-form note against a property — reminders, context, decisions — with light structure
 * (category/tags/reminder date) so a long-running property builds up a searchable history. */
export interface PropertyNote {
  id: string;
  created_at?: string;
  propertyId: string;
  unitId?: string;
  title: string;
  category?: string;
  tags: string[];
  reminderDate?: string;
  content?: string;
  attachments: { name: string; data: string }[];
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
