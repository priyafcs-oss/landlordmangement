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

/** Strict JSON shape requested from Gemini. */
export interface ParsedBillFields {
  vendor: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
  property_address: string;
  bpay_biller_code: string | null;
  bpay_reference: string | null;
  ato_category: string;
  /** Gemini's own 0-1 estimate of extraction certainty, used by the low-confidence guardrail. */
  confidence: number;
}

export interface ParseResult {
  ok: boolean;
  expenseId?: string;
  status?: "approved" | "needs_review";
  reviewReason?: string | null;
  matchedPropertyId?: string | null;
  error?: string;
}

export type DocumentType = "bill" | "lease_agreement" | "rent_statement" | "other";

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
  property_address: string;
  confidence: number;
}

/** Result shape shared by the lease and rent-statement extractors — both stage a proposal, never write directly. */
export interface ProposalParseResult {
  ok: boolean;
  proposalId?: string;
  error?: string;
}
