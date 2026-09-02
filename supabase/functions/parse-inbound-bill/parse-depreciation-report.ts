import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedDepreciationReportFields, ProposalParseResult } from "./types.ts";
import { isDuplicateEmailMessageId, findByEmailMessageId } from "./idempotency.ts";

export const DEPRECIATION_PROMPT = `You are extracting a tax depreciation schedule from a quantity surveyor's report forwarded to an Australian landlord.
Extract the fields defined in the response schema as strict JSON.
- property_address: the property this schedule is for.
- quantity_surveyor: the firm/individual who prepared the report, if stated, else null.
- report_reference: any report/job reference number printed on the document, else null.
- report_date, effective_from: YYYY-MM-DD. effective_from is the date depreciation starts being claimable (often the settlement/purchase date or report date) — null if not stated.
- items: every individual depreciable asset/item listed in the schedule, each with:
  - description: the item name, e.g. "Hot water system", "Carpet", "Dishwasher".
  - division: "Div 40" for plant & equipment (removable items — appliances, carpet, blinds), "Div 43" for capital works (structural/building costs), or null if you cannot tell.
  - cost: the item's depreciable cost/value as shown in the schedule.
  - life_years: the effective life in years, if stated, else null.
Do not invent items or values — only extract what the document actually lists.
- addressed_to: the "prepared for" name on the report cover page, if present — often the property owner. Null if not stated.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    property_address: { type: "STRING" },
    quantity_surveyor: { type: "STRING", nullable: true },
    report_reference: { type: "STRING", nullable: true },
    report_date: { type: "STRING", nullable: true },
    effective_from: { type: "STRING", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          division: { type: "STRING", nullable: true },
          cost: { type: "NUMBER" },
          life_years: { type: "NUMBER", nullable: true },
        },
        required: ["description", "cost"],
      },
    },
    addressed_to: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["property_address", "items", "confidence"],
};

export async function extractDepreciationReportFields(input: NormalizedBillInput): Promise<ParsedDepreciationReportFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(DEPRECIATION_PROMPT, input);
  return callGeminiJSON<ParsedDepreciationReportFields>(apiKey, parts, SCHEMA);
}

/**
 * Stages a "depreciation_report" proposal — like leases and property documents, this always
 * needs human confirmation (division/cost/life per item) before creating DepreciationItem rows,
 * since it's tax-relevant data extracted from a document, not a routine bill.
 */
export async function parseDepreciationReport(
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

  let parsed: ParsedDepreciationReportFields;
  try {
    parsed = await extractDepreciationReportFields(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  if (!parsed.items?.length) return { ok: false, error: "No depreciation items found" };

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "depreciation_report",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    documentDate: parsed.report_date ?? undefined,
    providerName: parsed.quantity_surveyor ?? undefined,
    addressedTo: parsed.addressed_to ?? undefined,
    payload: {
      quantitySurveyor: parsed.quantity_surveyor ?? undefined,
      reportReference: parsed.report_reference ?? undefined,
      reportDate: parsed.report_date ?? undefined,
      effectiveFrom: parsed.effective_from ?? undefined,
      items: parsed.items.map((it) => ({
        description: it.description,
        division: it.division ?? "Div 40",
        cost: it.cost,
        lifeYears: it.life_years ?? undefined,
      })),
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
