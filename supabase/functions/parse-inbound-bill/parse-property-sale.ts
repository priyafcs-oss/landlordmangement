import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedPropertySaleFields, ProposalParseResult } from "./types.ts";

const PROMPT = `You are extracting disposal details from a document where the LANDLORD is the SELLER — a Contract of Sale on disposal, a real estate agent's commission invoice for a sale, or a settlement statement on sale. This is NOT a purchase document (where the landlord is the buyer).
Extract the fields defined in the response schema as strict JSON.
- property_address: the property being sold.
- sale_date: YYYY-MM-DD — the contract/settlement date, null if not stated.
- sale_price: the total sale price, null if not stated.
- selling_costs: total selling costs if this specific document shows them (agent commission, marketing, legal fees on sale) — null if not stated. If this document IS itself just an agent commission invoice, that invoice's amount is the selling_costs figure.
- buyer_name: the purchaser's name, if stated, else null.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    property_address: { type: "STRING" },
    sale_date: { type: "STRING", nullable: true },
    sale_price: { type: "NUMBER", nullable: true },
    selling_costs: { type: "NUMBER", nullable: true },
    buyer_name: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["property_address", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedPropertySaleFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(PROMPT, input);
  return callGeminiJSON<ParsedPropertySaleFields>(apiKey, parts, SCHEMA);
}

/** Stages a "property_sale" proposal — a disposal is significant enough to always need explicit
 * confirmation before marking a property Sold. */
export async function parsePropertySale(
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

  let parsed: ParsedPropertySaleFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  if (!parsed.property_address) return { ok: false, error: "Missing property_address" };

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address);

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "property_sale",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    payload: {
      saleDate: parsed.sale_date ?? undefined,
      salePrice: parsed.sale_price ?? undefined,
      sellingCosts: parsed.selling_costs ?? undefined,
      buyerName: parsed.buyer_name ?? undefined,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

  return { ok: true, proposalId: row.id };
}
