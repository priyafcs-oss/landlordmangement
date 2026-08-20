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
  /** Free-text category Gemini assigns, mapped onto the app's BillType union for scheduling. */
  bill_category: string;
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
  /** Gemini's own 0-1 estimate of extraction certainty, used by the low-confidence guardrail. */
  confidence: number;
}

export interface ParseResult {
  ok: boolean;
  expenseId?: string;
  status?: "approved" | "needs_review";
  reviewReason?: string | null;
  matchedPropertyId?: string | null;
  scheduledBillsCreated?: number;
  error?: string;
}

export type DocumentType = "bill" | "lease_agreement" | "rent_statement" | "property_document" | "other";

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
  confidence: number;
}

/** Strict JSON shape requested from Gemini for a rent statement/ledger. */
export interface ParsedLedgerFields {
  tenantName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactions: { date: string; amount: number; description: string }[];
  /** Expense lines on the same statement — e.g. a managing agent's fee, or a bill they paid on the owner's behalf. */
  expenseLines: { vendor: string; amount: number; date: string; description: string; category: string }[];
  /** The statement's own stated net-to-owner figure, if shown, for a reconciliation sanity check. Null if not stated. */
  netToOwner: number | null;
  property_address: string;
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
  confidence: number;
}
