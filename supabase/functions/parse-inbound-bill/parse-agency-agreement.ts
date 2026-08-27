import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput } from "./types.ts";

const AGREEMENT_PROMPT = `You are extracting fee terms from an Australian Property Management Agreement (PMA) / agency agreement between a landlord and a real estate agency.
Extract the fields defined in the response schema as strict JSON.
- management_fee_percent is the ongoing management fee as a percentage of rent collected (e.g. a clause reading "6.6% of rent collected, inclusive of GST" -> 6.6). Use the all-inclusive/effective rate actually charged if both a base rate and a GST-inclusive rate are shown. Null if not stated.
- letting_fee_amount is a flat dollar letting/leasing fee charged when a new tenant is placed. Null if the agreement instead expresses this as a number of weeks' rent, or doesn't state one.
- letting_fee_weeks_rent is the letting fee expressed as a number of weeks' rent (e.g. "one week's rent plus GST" -> 1, "2 weeks rent" -> 2). Null if a flat dollar amount is used instead, or not stated.
- admin_fee_amount is a flat administration/statement fee charged separately from the % management fee (sometimes called a "statement fee" or "admin fee"). Null if not stated.
- admin_fee_frequency is how often the admin fee is charged: one of "Per Statement", "Monthly", "Quarterly", "Annually". Null if admin_fee_amount is null or frequency isn't stated.
- lease_renewal_fee_amount is a flat fee charged when an existing tenant's lease is renewed/extended. Null if not stated.
- inspection_fee_amount is a flat fee charged per routine/entry/exit inspection, if billed separately from the management fee. Null if not stated.
- agency_name is the real estate agency's registered/trading name as printed on the agreement. Null if not clearly stated.
- contract_start_date is when the agreement commences, formatted YYYY-MM-DD. Null if not stated.
- contract_review_date is when the agreement is next up for renewal/review/expiry, formatted YYYY-MM-DD. Null if not stated.
- document_date is the date the agreement itself was signed/prepared, distinct from contract_start_date. Null if not stated.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is, based on how clearly each fee was stated in the source. Use 1.0 only when every field was explicit and unambiguous; lower it when you had to infer or guess, or when most fields came back null because the document doesn't look like a management agreement at all.`;

const AGREEMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    management_fee_percent: { type: "NUMBER", nullable: true },
    letting_fee_amount: { type: "NUMBER", nullable: true },
    letting_fee_weeks_rent: { type: "NUMBER", nullable: true },
    admin_fee_amount: { type: "NUMBER", nullable: true },
    admin_fee_frequency: { type: "STRING", nullable: true },
    lease_renewal_fee_amount: { type: "NUMBER", nullable: true },
    inspection_fee_amount: { type: "NUMBER", nullable: true },
    agency_name: { type: "STRING", nullable: true },
    contract_start_date: { type: "STRING", nullable: true },
    contract_review_date: { type: "STRING", nullable: true },
    document_date: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["confidence"],
};

export interface ParsedAgencyAgreementFields {
  management_fee_percent: number | null;
  letting_fee_amount: number | null;
  letting_fee_weeks_rent: number | null;
  admin_fee_amount: number | null;
  admin_fee_frequency: string | null;
  lease_renewal_fee_amount: number | null;
  inspection_fee_amount: number | null;
  agency_name: string | null;
  contract_start_date: string | null;
  contract_review_date: string | null;
  document_date: string | null;
  confidence: number;
}

/** Stateless extraction — same shape as extractBillFields (core-parser.ts) but with no
 * email-pipeline caller: a management agreement only ever arrives via a landlord's direct
 * "Upload & extract" in the agent's Provider record, never through the inbox. */
export async function extractAgencyAgreementFields(input: NormalizedBillInput): Promise<ParsedAgencyAgreementFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(AGREEMENT_PROMPT, input);
  return callGeminiJSON<ParsedAgencyAgreementFields>(apiKey, parts, AGREEMENT_SCHEMA);
}
