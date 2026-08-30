import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ProposalParseResult } from "./types.ts";

const AGREEMENT_PROMPT = `You are extracting fee terms from an Australian Property Management Agreement (PMA) / agency agreement between a landlord and a real estate agency.
Extract the fields defined in the response schema as strict JSON.
- property_address: the address of the property this agreement covers, as printed on the agreement. Null if not stated.
- management_fee_percent is the ongoing management fee as a percentage of rent collected (e.g. a clause reading "6.6% of rent collected, inclusive of GST" -> 6.6). Use the all-inclusive/effective rate actually charged if both a base rate and a GST-inclusive rate are shown. Null if not stated.
- letting_fee_amount is a flat dollar letting/leasing fee charged when a new tenant is placed. Null if the agreement instead expresses this as a number of weeks' rent, or doesn't state one.
- letting_fee_weeks_rent is the letting fee expressed as a number of weeks' rent (e.g. "one week's rent plus GST" -> 1, "2 weeks rent" -> 2). Null if a flat dollar amount is used instead, or not stated.
- admin_fee_amount is a flat administration/statement fee charged separately from the % management fee (sometimes called a "statement fee" or "admin fee"). Null if not stated.
- admin_fee_frequency is how often the admin fee is charged: one of "Per Statement", "Monthly", "Quarterly", "Annually". Null if admin_fee_amount is null or frequency isn't stated.
- lease_renewal_fee_amount is a flat fee charged when an existing tenant's lease is renewed/extended. Null if not stated.
- inspection_fee_amount is a flat fee charged per routine/entry/exit inspection, if billed separately from the management fee. Null if not stated.
- advertising_fee_amount is a flat marketing/advertising fee charged when the property is listed for a new tenant, separate from the letting fee itself (sometimes called a "marketing fee" or "sign board fee"). Null if not stated.
- notice_period_days is the notice period (in days) either party must give to terminate the agreement (e.g. "30 days written notice" -> 30, "60 days" -> 60). Null if not stated.
- agency_name is the real estate agency's registered/trading name as printed on the agreement. Null if not clearly stated.
- contract_start_date is when the agreement commences, formatted YYYY-MM-DD. Null if not stated.
- contract_review_date is when the agreement is next up for renewal/review/expiry, formatted YYYY-MM-DD. Null if not stated.
- document_date is the date the agreement itself was signed/prepared, distinct from contract_start_date. Null if not stated.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is, based on how clearly each fee was stated in the source. Use 1.0 only when every field was explicit and unambiguous; lower it when you had to infer or guess, or when most fields came back null because the document doesn't look like a management agreement at all.`;

const AGREEMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    property_address: { type: "STRING", nullable: true },
    management_fee_percent: { type: "NUMBER", nullable: true },
    letting_fee_amount: { type: "NUMBER", nullable: true },
    letting_fee_weeks_rent: { type: "NUMBER", nullable: true },
    admin_fee_amount: { type: "NUMBER", nullable: true },
    admin_fee_frequency: { type: "STRING", nullable: true },
    lease_renewal_fee_amount: { type: "NUMBER", nullable: true },
    inspection_fee_amount: { type: "NUMBER", nullable: true },
    advertising_fee_amount: { type: "NUMBER", nullable: true },
    notice_period_days: { type: "NUMBER", nullable: true },
    agency_name: { type: "STRING", nullable: true },
    contract_start_date: { type: "STRING", nullable: true },
    contract_review_date: { type: "STRING", nullable: true },
    document_date: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["confidence"],
};

export interface ParsedAgencyAgreementFields {
  property_address: string | null;
  management_fee_percent: number | null;
  letting_fee_amount: number | null;
  letting_fee_weeks_rent: number | null;
  admin_fee_amount: number | null;
  admin_fee_frequency: string | null;
  lease_renewal_fee_amount: number | null;
  inspection_fee_amount: number | null;
  advertising_fee_amount: number | null;
  notice_period_days: number | null;
  agency_name: string | null;
  contract_start_date: string | null;
  contract_review_date: string | null;
  document_date: string | null;
  confidence: number;
}

/** Stateless extraction — used by the landlord's direct "Upload & extract" in the agent's
 * Provider record, and by stageAgencyAgreementProposal below for the inbox/upload pipeline. */
export async function extractAgencyAgreementFields(input: NormalizedBillInput): Promise<ParsedAgencyAgreementFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(AGREEMENT_PROMPT, input);
  return callGeminiJSON<ParsedAgencyAgreementFields>(apiKey, parts, AGREEMENT_SCHEMA);
}

/** Stages an "agency_agreement" proposal — always needs human confirmation before it's applied to
 * the property's Agent Provider record (a signed PMA is too consequential to auto-apply, and the
 * landlord may need to pick which Provider it belongs to when a property has more than one). */
export async function stageAgencyAgreementProposal(
  supabase: SupabaseClient,
  input: NormalizedBillInput,
  emailMessageId: string | null,
): Promise<ProposalParseResult> {
  if (emailMessageId) {
    const { data: existing } = await supabase
      .from("ai_intake_proposals")
      .select("id")
      .eq("emailMessageId", emailMessageId)
      .maybeSingle();
    if (existing) return { ok: true, proposalId: existing.id };
  }

  let parsed: ParsedAgencyAgreementFields;
  try {
    parsed = await extractAgencyAgreementFields(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "agency_agreement",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    documentDate: parsed.document_date ?? undefined,
    providerName: parsed.agency_name ?? undefined,
    payload: {
      agencyName: parsed.agency_name ?? undefined,
      managementFeePercent: parsed.management_fee_percent ?? undefined,
      lettingFeeAmount: parsed.letting_fee_amount ?? undefined,
      lettingFeeWeeksRent: parsed.letting_fee_weeks_rent ?? undefined,
      adminFeeAmount: parsed.admin_fee_amount ?? undefined,
      adminFeeFrequency: parsed.admin_fee_frequency ?? undefined,
      leaseRenewalFeeAmount: parsed.lease_renewal_fee_amount ?? undefined,
      inspectionFeeAmount: parsed.inspection_fee_amount ?? undefined,
      advertisingFeeAmount: parsed.advertising_fee_amount ?? undefined,
      noticePeriodDays: parsed.notice_period_days ?? undefined,
      contractStartDate: parsed.contract_start_date ?? undefined,
      contractReviewDate: parsed.contract_review_date ?? undefined,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

  return { ok: true, proposalId: row.id };
}
