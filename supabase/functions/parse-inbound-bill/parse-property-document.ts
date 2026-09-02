import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedPropertyDocumentFields, ProposalParseResult } from "./types.ts";
import { isDuplicateEmailMessageId, findByEmailMessageId } from "./idempotency.ts";

const PROMPT = `You are extracting property ownership/policy details from a document forwarded to an Australian landlord — this is NOT a bill to be paid now. It's one of: a settlement statement, an insurance certificate/policy schedule, a strata/owners-corporation notice, or a purchase Contract of Sale (where the landlord is the buyer — the vendor/purchaser agreement itself, before or after settlement).
Extract the fields defined in the response schema as strict JSON. Every field except document_category, property_address and confidence is nullable — only fill in what this specific document actually states, leave the rest null. Do not guess or invent values.
- document_category: your best short label for what kind of document this is, e.g. "Settlement Statement", "Insurance Certificate", "Strata Notice", "Contract of Sale".
- property_address: the property this document is about.
- purchase_price, deposit: on a Contract of Sale these are in the Particulars of Sale / front page (often
  labelled "Price"/"Purchase Price" and "Deposit"); on a settlement statement they're the settlement
  figures. Extract whichever is stated even if the document is an unexecuted/unsettled contract.
- purchase_date: the settlement date. On a settlement statement this is a stated calendar date. On a
  Contract of Sale it's often expressed only as a formula relative to the contract date (e.g. "42 days
  after the Contract Date") rather than a fixed date — only fill this in if the document states an actual
  calendar date; leave it null if it's only a formula you can't resolve from the document alone.
- stamp_duty: rarely stated on a Contract of Sale itself (it's assessed separately after exchange) —
  leave it null unless the document actually states a figure; a settlement statement is more likely to
  include it as a settlement adjustment.
- insurance_renewal_date, smoke_alarm_check_due_date, pool_safety_cert_expiry,
  electrical_safety_cert_expiry, gas_safety_cert_expiry: YYYY-MM-DD.
- strata_levy_frequency: "Quarterly" or "Annually" if stated, else null.
- settlement_adjustments: REQUIRED — always include, even as an empty array [] when there's no such
  breakdown. A PEXA Settlement Completion Record or Statement of Adjustments typically lists
  several adjustment line items (council rates adjustment, water rates adjustment, land tax
  adjustment, registration fees) — extract each as its own item with a short description and its
  amount. Do not include the headline purchase_price/stamp_duty/deposit here, only the smaller
  adjustment items.
- owner_name: the purchaser/transferee/insured/owner named on the document — a settlement
  statement's "Purchaser(s)" or "Transferee" section, or the named insured on an insurance
  certificate. If two individuals are named (e.g. spouses), return both joined by " & " (e.g.
  "John Smith & Jane Smith"). If the owner is a trust or company, return its full legal name
  exactly as printed (e.g. "Smith Family Trust" or "Smith Investments Pty Ltd ATF Smith Family Trust").
- ownership_type: your best classification of owner_name as one of "Individual", "Joint", "Trust",
  "SMSF", or "Company" — "Joint" when two individual names are given, "Individual" for one person,
  "Trust"/"SMSF"/"Company" when the name itself says so (e.g. contains "Trust", "Super", "Pty Ltd").
  Null if owner_name is null.
- provider_name: the generic issuer of this document — the insurer for a policy, the body corporate/strata manager for a strata notice, the conveyancer for a settlement statement. Distinct from owner_name (who owns the property, not who issued the document). Null if not stated.
- document_date: the document's own issue date — null if not stated.
- addressed_to: the named insured on a policy, or the addressee on a strata/council notice — distinct from owner_name. Null if not stated.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    document_category: { type: "STRING" },
    property_address: { type: "STRING" },
    purchase_date: { type: "STRING", nullable: true },
    purchase_price: { type: "NUMBER", nullable: true },
    stamp_duty: { type: "NUMBER", nullable: true },
    deposit: { type: "NUMBER", nullable: true },
    owner_name: { type: "STRING", nullable: true },
    ownership_type: { type: "STRING", nullable: true },
    insurer_name: { type: "STRING", nullable: true },
    insurance_policy_number: { type: "STRING", nullable: true },
    insurance_premium: { type: "NUMBER", nullable: true },
    insurance_renewal_date: { type: "STRING", nullable: true },
    insurance_sum_insured: { type: "NUMBER", nullable: true },
    strata_levy_amount: { type: "NUMBER", nullable: true },
    strata_levy_frequency: { type: "STRING", nullable: true },
    smoke_alarm_check_due_date: { type: "STRING", nullable: true },
    pool_safety_cert_expiry: { type: "STRING", nullable: true },
    electrical_safety_cert_expiry: { type: "STRING", nullable: true },
    gas_safety_cert_expiry: { type: "STRING", nullable: true },
    settlement_adjustments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          amount: { type: "NUMBER" },
        },
        required: ["description", "amount"],
      },
    },
    provider_name: { type: "STRING", nullable: true },
    document_date: { type: "STRING", nullable: true },
    addressed_to: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["document_category", "property_address", "settlement_adjustments", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedPropertyDocumentFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(PROMPT, input);
  return callGeminiJSON<ParsedPropertyDocumentFields>(apiKey, parts, SCHEMA);
}

/**
 * Stages a "property_detail" proposal — like leases and rent statements, this always needs
 * human confirmation before touching the property record, since it's ownership/policy data,
 * not a routine bill. The review card lets the landlord pick which of the extracted fields to
 * actually apply, since one document rarely has all of them.
 */
export async function parsePropertyDocument(
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

  let parsed: ParsedPropertyDocumentFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  if (!parsed.document_category) return { ok: false, error: "Missing document_category" };

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "property_detail",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    documentDate: parsed.document_date ?? undefined,
    providerName: parsed.provider_name ?? parsed.insurer_name ?? undefined,
    addressedTo: parsed.addressed_to ?? undefined,
    payload: {
      documentCategory: parsed.document_category,
      purchaseDate: parsed.purchase_date ?? undefined,
      purchasePrice: parsed.purchase_price ?? undefined,
      stampDuty: parsed.stamp_duty ?? undefined,
      deposit: parsed.deposit ?? undefined,
      ownerName: parsed.owner_name ?? undefined,
      ownershipType: parsed.ownership_type ?? undefined,
      insurerName: parsed.insurer_name ?? undefined,
      insurancePolicyNumber: parsed.insurance_policy_number ?? undefined,
      insurancePremium: parsed.insurance_premium ?? undefined,
      insuranceRenewalDate: parsed.insurance_renewal_date ?? undefined,
      insuranceSumInsured: parsed.insurance_sum_insured ?? undefined,
      strataLevyAmount: parsed.strata_levy_amount ?? undefined,
      strataLevyFrequency: parsed.strata_levy_frequency ?? undefined,
      smokeAlarmCheckDueDate: parsed.smoke_alarm_check_due_date ?? undefined,
      poolSafetyCertExpiry: parsed.pool_safety_cert_expiry ?? undefined,
      electricalSafetyCertExpiry: parsed.electrical_safety_cert_expiry ?? undefined,
      gasSafetyCertExpiry: parsed.gas_safety_cert_expiry ?? undefined,
      settlementAdjustments: parsed.settlement_adjustments?.length ? parsed.settlement_adjustments : undefined,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) {
    if (emailMessageId && isDuplicateEmailMessageId(error)) {
      const existing = await findByEmailMessageId(supabase, "ai_intake_proposals", emailMessageId);
      if (existing) return { ok: true, proposalId: existing.id };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, proposalId: row.id };
}
