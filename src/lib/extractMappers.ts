import type { Loan, LoanDocumentProposalPayload } from "@/lib/types";

/** What extract-loan-document returns (snake_case, straight from the AI schema). */
export interface LoanExtractResult {
  lender_name?: string;
  loan_amount?: number | null;
  interest_rate?: number | null;
  monthly_repayment?: number | null;
  start_date?: string | null;
  maturity_date?: string | null;
  next_repayment_date?: string | null;
  product_type?: string | null;
  bsb?: string | null;
  account_number?: string | null;
  has_offset_account?: boolean | null;
  confidence?: number;
}

/** The AI result in the same shape the email/upload pipeline stores on a loan-document proposal. */
export function loanPayloadFromExtract(d: LoanExtractResult): LoanDocumentProposalPayload {
  return {
    lenderName: d.lender_name ?? "",
    loanAmount: d.loan_amount ?? undefined,
    interestRate: d.interest_rate ?? undefined,
    monthlyRepayment: d.monthly_repayment ?? undefined,
    startDate: d.start_date ?? undefined,
    maturityDate: d.maturity_date ?? undefined,
    nextRepaymentDate: d.next_repayment_date ?? undefined,
    productType: d.product_type ?? undefined,
    bsb: d.bsb ?? undefined,
    accountNumber: d.account_number ?? undefined,
    hasOffsetAccount: d.has_offset_account ?? undefined,
    confidence: d.confidence ?? 0,
  };
}

/** Day of month of a YYYY-MM-DD date, read from the string — `new Date(iso).getDate()` parses as
 * UTC and can land on the previous day in a timezone behind UTC. */
function dayOfMonth(iso: string | undefined): number | undefined {
  const day = iso ? Number(iso.slice(8, 10)) : NaN;
  return day >= 1 && day <= 31 ? day : undefined;
}

/**
 * Loan fields from a read loan document — one mapping for both the Add Loan dialog's upload and
 * the loan-document proposal card. `dueDayOfMonth` (what the Dashboard's "repayment due soon"
 * forecast reads) is derived from the next repayment date; without it that forecast stays empty.
 * Only fields the document actually gave are present.
 */
export function loanFieldsFromPayload(p: LoanDocumentProposalPayload): Partial<Loan> {
  const fields: Partial<Loan> = {
    bankName: p.lenderName || undefined,
    originalAmount: p.loanAmount,
    totalBalance: p.loanAmount,
    interestRate: p.interestRate,
    monthlyEmi: p.monthlyRepayment,
    startDate: p.startDate,
    maturityDate: p.maturityDate,
    nextRepaymentDate: p.nextRepaymentDate,
    dueDayOfMonth: dayOfMonth(p.nextRepaymentDate),
    productType: p.productType,
    bsb: p.bsb,
    accountNumber: p.accountNumber,
    hasOffsetAccount: p.hasOffsetAccount,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<Loan>;
}

/** What extract-agency-agreement returns (snake_case, straight from the AI schema). */
export interface AgencyAgreementExtractResult {
  management_fee_percent?: number | null;
  management_fee_gst_inclusive?: boolean | null;
  letting_fee_amount?: number | null;
  letting_fee_weeks_rent?: number | null;
  letting_fee_gst_inclusive?: boolean | null;
  admin_fee_amount?: number | null;
  admin_fee_frequency?: string | null;
  admin_fee_gst_inclusive?: boolean | null;
  lease_renewal_fee_amount?: number | null;
  lease_renewal_fee_gst_inclusive?: boolean | null;
  inspection_fee_amount?: number | null;
  inspection_fee_gst_inclusive?: boolean | null;
  inspections_per_year?: number | null;
  advertising_fee_amount?: number | null;
  advertising_fee_gst_inclusive?: boolean | null;
  lease_preparation_fee_amount?: number | null;
  lease_preparation_fee_gst_inclusive?: boolean | null;
  ncat_fee_amount?: string | null;
  ncat_fee_gst_inclusive?: boolean | null;
  agent_pays_water_usage?: boolean | null;
  agent_pays_land_tax?: boolean | null;
  agent_pays_council_rates?: boolean | null;
  notice_period_days?: number | null;
  agency_name?: string | null;
  contract_start_date?: string | null;
  contract_review_date?: string | null;
  confidence?: number;
}

/** The agreement-form fields a read management agreement fills in. String values for the form's
 * text inputs; each fee's "includes GST" flag comes with its amount. */
export interface AgreementExtractFields {
  managementFeePercent?: string;
  managementFeeGstInclusive?: boolean;
  lettingFeeAmount?: string;
  lettingFeeWeeksRent?: string;
  lettingFeeGstInclusive?: boolean;
  adminFeeAmount?: string;
  adminFeeGstInclusive?: boolean;
  adminFeeFrequency?: string;
  leaseRenewalFeeAmount?: string;
  leaseRenewalFeeGstInclusive?: boolean;
  inspectionFeeAmount?: string;
  inspectionFeeGstInclusive?: boolean;
  inspectionsPerYear?: string;
  advertisingFeeAmount?: string;
  advertisingFeeGstInclusive?: boolean;
  leasePreparationFeeAmount?: string;
  leasePreparationFeeGstInclusive?: boolean;
  ncatFeeAmount?: string;
  ncatFeeGstInclusive?: boolean;
  agentPaysWaterUsage?: boolean;
  agentPaysLandTax?: boolean;
  agentPaysCouncilRates?: boolean;
  noticePeriodDays?: string;
  contractStartDate?: string;
  contractReviewDate?: string;
}

/** Agreement-form fields from a read management agreement, and how many terms were found. */
export function agreementFieldsFromExtract(d: AgencyAgreementExtractResult): {
  fields: AgreementExtractFields;
  found: number;
} {
  const fields: AgreementExtractFields = {};
  let found = 0;
  const has = <T>(v: T | null | undefined): v is T => v !== undefined && v !== null;
  const fee = (
    amount: number | string | null | undefined,
    gst: boolean | null | undefined,
    set: (a: string, g: boolean) => void,
  ) => {
    if (!has(amount)) return;
    set(String(amount), gst ?? false);
    found++;
  };
  fee(d.management_fee_percent, d.management_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { managementFeePercent: a, managementFeeGstInclusive: g }),
  );
  fee(d.letting_fee_amount, d.letting_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { lettingFeeAmount: a, lettingFeeGstInclusive: g }),
  );
  fee(d.letting_fee_weeks_rent, d.letting_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { lettingFeeWeeksRent: a, lettingFeeGstInclusive: g }),
  );
  fee(d.admin_fee_amount, d.admin_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { adminFeeAmount: a, adminFeeGstInclusive: g }),
  );
  fee(d.lease_renewal_fee_amount, d.lease_renewal_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { leaseRenewalFeeAmount: a, leaseRenewalFeeGstInclusive: g }),
  );
  fee(d.inspection_fee_amount, d.inspection_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { inspectionFeeAmount: a, inspectionFeeGstInclusive: g }),
  );
  fee(d.advertising_fee_amount, d.advertising_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { advertisingFeeAmount: a, advertisingFeeGstInclusive: g }),
  );
  fee(d.lease_preparation_fee_amount, d.lease_preparation_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { leasePreparationFeeAmount: a, leasePreparationFeeGstInclusive: g }),
  );
  fee(d.ncat_fee_amount, d.ncat_fee_gst_inclusive, (a, g) =>
    Object.assign(fields, { ncatFeeAmount: a, ncatFeeGstInclusive: g }),
  );
  const plain = <K extends keyof AgreementExtractFields>(
    key: K,
    v: AgreementExtractFields[K] | null | undefined,
  ) => {
    if (!has(v) || v === "") return;
    fields[key] = v;
    found++;
  };
  plain("adminFeeFrequency", d.admin_fee_frequency);
  plain(
    "inspectionsPerYear",
    has(d.inspections_per_year) ? String(d.inspections_per_year) : undefined,
  );
  plain("agentPaysWaterUsage", d.agent_pays_water_usage);
  plain("agentPaysLandTax", d.agent_pays_land_tax);
  plain("agentPaysCouncilRates", d.agent_pays_council_rates);
  plain("noticePeriodDays", has(d.notice_period_days) ? String(d.notice_period_days) : undefined);
  plain("contractStartDate", d.contract_start_date);
  plain("contractReviewDate", d.contract_review_date);
  return { fields, found };
}
