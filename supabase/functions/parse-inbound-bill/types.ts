/** Provider-independent input shape any inbound-email adapter normalizes into before calling the core parser. */
export interface NormalizedBillInput {
  fromEmail: string;
  subject: string;
  pdfBase64?: string;
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
