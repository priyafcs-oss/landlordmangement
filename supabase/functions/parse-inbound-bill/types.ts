/** Provider-independent input shape any inbound-email adapter normalizes into before calling the core parser. */
export interface NormalizedBillInput {
  fromEmail: string;
  subject: string;
  /** Base64 attachment content — despite the name, may be a PDF or an image (see attachmentMimeType). */
  pdfBase64?: string;
  pdfFileName?: string;
  /** MIME type of pdfBase64, e.g. "application/pdf" or "image/png". Defaults to "application/pdf" if unset. */
  attachmentMimeType?: string;
  textBody?: string;
  /** Set only by the "Upload statement to this loan" button (see upload-document/index.ts) —
   * asserts this document is a statement for a specific existing Loan, so the router skips
   * classification entirely and parse-loan-statement resolves the match/property directly from
   * the loan record instead of the usual fuzzy property/lender matching. */
  loanIdHint?: string;
}

/** A later instalment printed on the same notice (e.g. quarterly council/water rates) — not yet due. */
export interface ParsedFutureInstalment {
  due_date: string; // YYYY-MM-DD
  amount: number;
}

/** Strict JSON shape requested from Gemini. */
export interface ParsedBillFields {
  vendor: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
  property_address: string;
  bpay_biller_code: string | null;
  bpay_reference: string | null;
  ato_category: string;
  /** Free-text category Gemini assigns, mapped onto the app's BillType union for scheduling
   * (Water/Council Rates/Strata/Insurance/Electricity/Gas/Other) — deliberately narrow, only for
   * the handful of bill types with their own scheduling/annual-cost/rebill behavior. */
  bill_category: string;
  /** Free-text category Gemini assigns from the app's full ATO expense-category taxonomy (see
   * mapExpenseCategory) — the one that actually drives the Category field on Add Bill/Add
   * Transaction. bill_category alone can't do this: any bill that isn't one of its 7 fixed values
   * (a repair invoice, pest control, gardening, legal fees, ...) was falling back to the generic
   * "Sundry Rental Expenses" with no attempt at a real category. */
  expense_category: string;
  /** Any OTHER instalments/due dates printed on the same notice besides the one currently due — e.g. a
   * council rates notice listing all 4 quarters. Empty array if the notice only shows one payment. */
  future_instalments: ParsedFutureInstalment[];
  /** Best-effort vendor contact details, when printed on the notice — used to build a provider directory. Null if not shown. */
  vendor_email: string | null;
  vendor_phone: string | null;
  vendor_website: string | null;
  vendor_abn: string | null;
  vendor_address: string | null;
  /** The current instalment's total broken into its component charges (e.g. water bill's fixed
   * access charge + usage charge) — one item covering the whole total if the notice shows no breakdown. */
  line_items: { description: string; amount: number }[];
  /** The billing/account name the notice is addressed to, if printed. Null if not shown. */
  addressed_to: string | null;
  /** Gemini's own 0-1 estimate of extraction certainty, used by the low-confidence guardrail. */
  confidence: number;
}

export interface ParseResult {
  ok: boolean;
  /** The created property_bills row's id — bills no longer get a paired Expense at intake, only
   * once actually marked Paid, so this never points at an expenses row. */
  billId?: string;
  /** Set instead of billId when this upload was matched to an existing Expense (same vendor,
   * amount and roughly the same date) that had no invoice file yet — e.g. a water bill line
   * posted from an agent statement, with the actual bill PDF forwarded/uploaded afterwards. The
   * file is attached directly to that Expense rather than creating a second, disconnected Bill
   * record for the same real-world charge. */
  linkedExpenseId?: string;
  status?: "approved" | "needs_review";
  reviewReason?: string | null;
  matchedPropertyId?: string | null;
  scheduledBillsCreated?: number;
  error?: string;
}

export type DocumentType =
  | "bill"
  | "lease_agreement"
  | "rent_statement"
  | "property_document"
  | "depreciation_report"
  | "loan_document"
  | "loan_statement"
  | "bank_statement"
  | "property_sale"
  | "agency_agreement"
  | "other";

export interface ClassificationResult {
  document_type: DocumentType;
  confidence: number;
}

/** Strict JSON shape requested from Gemini for a lease/rent agreement. */
export interface ParsedLeaseFields {
  name: string;
  email: string | null;
  phone: string | null;
  rentAmount: number;
  rentFrequency: "Weekly" | "Fortnightly" | "Monthly";
  leaseStart: string | null; // YYYY-MM-DD
  leaseExpiry: string | null; // YYYY-MM-DD
  leaseDuration: "6 Months" | "12 Months" | "Periodic" | null;
  bondAmount: number | null;
  property_address: string;
  /** The date the agreement was signed/prepared — distinct from leaseStart. Null if not stated. */
  document_date: string | null;
  /** The managing agency preparing/sending the lease, if any — null for a self-managed landlord. */
  managing_agent_name: string | null;
  confidence: number;
}

/** Strict JSON shape requested from Gemini for a rent statement/ledger. */
export interface ParsedLedgerFields {
  tenantName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** tenantName here is per-line, distinct from the top-level tenantName — set only when a
   * changeover statement clearly attributes this specific payment to a named tenant (an outgoing
   * and incoming tenant both paying rent within the same statement period). Null otherwise. */
  transactions: { date: string; amount: number; description: string; tenantName: string | null }[];
  /** Expense lines on the same statement — e.g. a managing agent's fee, or a bill they paid on the owner's behalf. */
  expenseLines: { vendor: string; amount: number; date: string; description: string; category: string }[];
  /** The statement's own stated net-to-owner figure, if shown, for a reconciliation sanity check. Null if not stated. */
  netToOwner: number | null;
  /** Balance held by the agent brought forward from the previous statement / carried forward to
   * the next one — when present, the actual amount paid to the owner is
   * (period income - period expenses) + openingBalance - closingBalance, not just the period's
   * own activity, which is why these are captured separately rather than folded into netToOwner.
   * Null if the statement shows no balance rollover. */
  openingBalance: number | null;
  closingBalance: number | null;
  property_address: string;
  /** The statement's own issue/print date — distinct from periodStart/periodEnd. Null if not stated. */
  document_date: string | null;
  /** The managing agency issuing the statement, if any. Null if not stated. */
  managing_agent_name: string | null;
  confidence: number;
}

/** Result shape shared by the lease and rent-statement extractors — both stage a proposal, never write directly. */
export interface ProposalParseResult {
  ok: boolean;
  proposalId?: string;
  error?: string;
}

/**
 * Strict JSON shape requested from Gemini for a property document — settlement statement,
 * insurance certificate/policy, or strata notice. Every field is nullable since any one
 * document typically only carries a handful of these; the caller applies only what's present.
 */
export interface ParsedPropertyDocumentFields {
  document_category: string; // e.g. "Settlement Statement", "Insurance Certificate", "Strata Notice"
  property_address: string;
  purchase_date: string | null;
  purchase_price: number | null;
  stamp_duty: number | null;
  deposit: number | null;
  owner_name: string | null;
  ownership_type: string | null;
  insurer_name: string | null;
  insurance_policy_number: string | null;
  insurance_premium: number | null;
  insurance_renewal_date: string | null;
  insurance_sum_insured: number | null;
  strata_levy_amount: number | null;
  strata_levy_frequency: string | null; // "Quarterly" | "Annually"
  smoke_alarm_check_due_date: string | null;
  pool_safety_cert_expiry: string | null;
  electrical_safety_cert_expiry: string | null;
  gas_safety_cert_expiry: string | null;
  /** PEXA settlement record / Statement of Adjustments line items (council/water rate adjustments,
   * registration fees) — empty array if the document shows no such breakdown. */
  settlement_adjustments: { description: string; amount: number }[];
  /** Generic issuer — insurer for a policy, body corporate manager for a strata notice, conveyancer
   * for a settlement statement. Distinct from owner_name (who owns the property). Null if not stated. */
  provider_name: string | null;
  /** Generic document issue date — distinct from purchase_date/insurance_renewal_date/etc. Null if not stated. */
  document_date: string | null;
  /** The named insured/addressee on a policy, or the addressee on a strata notice. Null if not stated. */
  addressed_to: string | null;
  confidence: number;
}

/** Strict JSON shape requested from Gemini for a quantity surveyor's depreciation schedule/report. */
export interface ParsedDepreciationReportFields {
  property_address: string;
  quantity_surveyor: string | null;
  report_reference: string | null;
  report_date: string | null; // YYYY-MM-DD
  effective_from: string | null; // YYYY-MM-DD
  items: {
    description: string;
    division: "Div 40" | "Div 43" | null;
    cost: number;
    life_years: number | null;
    /** This item's own Year 1, Year 2, ... claim amounts exactly as printed in the report's
     * year-by-year table, in order — most QS reports include one per item (often titled "Years 1
     * to 10" or similar, continuing on later pages/tables for the item's full life). Null/omitted
     * if the report doesn't break this item down by year (a summary-only report), in which case
     * the app projects it from cost/life/method instead — but that's an approximation, so the
     * report's own stated figures always take priority when they're actually printed. */
    annual_claims: number[] | null;
  }[];
  /** "Prepared for" name on the report cover page, if present — often the owner name. Null if not stated. */
  addressed_to: string | null;
  confidence: number;
}

/** Strict JSON shape requested from Gemini for an initial loan/mortgage document. */
export interface ParsedLoanDocumentFields {
  property_address: string;
  lender_name: string;
  loan_amount: number | null;
  interest_rate: number | null;
  monthly_repayment: number | null;
  start_date: string | null; // YYYY-MM-DD
  /** YYYY-MM-DD — when the loan term ends. Null if not stated. */
  maturity_date: string | null;
  /** YYYY-MM-DD — the first/next scheduled repayment date. Null if not stated. */
  next_repayment_date: string | null;
  /** The lender's own name for this loan product, e.g. "Home Loan", "Investment Loan", "Line of
   * Credit" — free text since wording varies bank to bank. Null if not stated. */
  product_type: string | null;
  bsb: string | null;
  account_number: string | null;
  has_offset_account: boolean | null;
  /** The document's own date — distinct from start_date (loan commencement can post-date it). Null if not stated. */
  document_date: string | null;
  /** The borrower's name as printed. Null if not stated. */
  addressed_to: string | null;
  confidence: number;
}

/** Strict JSON shape requested from Gemini for an ongoing loan statement. */
export interface ParsedLoanStatementFields {
  property_address: string;
  lender_name: string;
  period_start: string | null; // YYYY-MM-DD
  period_end: string | null; // YYYY-MM-DD
  interest_charged: number | null;
  repayments_made: number | null;
  closing_balance: number | null;
  /** The portion of repayments_made that reduced principal this period, when the statement
   * breaks it out separately from interest_charged. Null if not stated/not broken out. */
  principal_paid: number | null;
  /** The fixed repayment amount due each period. Null if not stated. */
  emi_amount_due: number | null;
  /** YYYY-MM-DD — the next scheduled repayment date. Null if not stated. */
  next_emi_due_date: string | null;
  /** Last 4 digits of the loan/account number printed on the statement. Null if not shown. */
  account_number_last4: string | null;
  /** The statement's own print date — distinct from period_end. Null if not stated. */
  document_date: string | null;
  /** The account holder name printed on the statement. Null if not stated. */
  addressed_to: string | null;
  confidence: number;
}

/** Strict JSON shape requested from Gemini for a general bank statement (not an agent rent statement). */
export interface ParsedBankStatementFields {
  property_address: string | null;
  bank_name: string | null;
  period_start: string | null; // YYYY-MM-DD
  period_end: string | null; // YYYY-MM-DD
  transactions: { date: string; description: string; amount: number; direction: "in" | "out" }[];
  /** The account holder name printed on the statement — helps disambiguate a personal account mixing properties. Null if not stated. */
  addressed_to: string | null;
  confidence: number;
}

/** Strict JSON shape requested from Gemini for a Contract of Sale (disposal) or settlement statement on sale. */
export interface ParsedPropertySaleFields {
  property_address: string;
  sale_date: string | null; // YYYY-MM-DD
  sale_price: number | null;
  selling_costs: number | null;
  /** The Contract of Sale's own date — distinct from sale_date (settlement). Null if not stated. */
  document_date: string | null;
  /** The conveyancer/selling agent's name, if stated. Null if not stated. */
  provider_name: string | null;
  buyer_name: string | null;
  confidence: number;
}
