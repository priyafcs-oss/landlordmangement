import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { ClassificationResult, NormalizedBillInput } from "./types.ts";

const CLASSIFY_PROMPT_BASE = `You are triaging an email forwarded to a landlord's property-management inbox. Classify it into exactly one of these categories:
- "bill": an invoice/bill for a property expense (council rates, water, strata, insurance, electricity, gas, or similar) stating an amount owed and a due date — i.e. something currently payable.
- "lease_agreement": a residential tenancy/lease agreement, or a lease renewal, naming a tenant, rent amount, and lease dates.
- "rent_statement": a rent statement, ledger, or remittance advice from a managing AGENT listing rent payments/transactions over a period, usually with a management fee deducted. Do NOT use this for a landlord's own personal/business bank account statement — that's "bank_statement" instead.
- "property_document": a document that describes the PROPERTY ITSELF rather than something currently payable — a purchase/settlement statement, a conveyancer's settlement figures, a PEXA settlement completion record or Statement of Adjustments, a Certificate/Title, an insurance certificate of currency or policy schedule, a strata/owners-corporation notice showing the levy amount, or a compliance certificate (smoke alarm, electrical safety, gas safety, pool/barrier). Use this even if the document also mentions a dollar figure, as long as it's describing an ownership/policy/levy/compliance detail rather than an invoice due now.
- "depreciation_report": a tax depreciation schedule/report from a quantity surveyor, listing depreciable plant & equipment or capital works items with costs and effective lives (often titled "Tax Depreciation Schedule" or similar).
- "loan_document": an initial loan/mortgage offer, contract, or approval letter from a lender — establishes a NEW loan (lender, amount, rate, repayment).
- "loan_statement": an ONGOING periodic statement from a lender on an EXISTING loan/mortgage, showing interest charged, repayments made, and the closing balance over a period.
- "bank_statement": a landlord's own personal or business bank/transaction account statement (not a managing agent's rent statement) listing a list of transactions over a period.
- "property_sale": a Contract of Sale where the LANDLORD is the seller/vendor (disposing of the property), a real estate agent's commission invoice for a sale, or a settlement statement on sale showing proceeds and selling costs. Distinguish from a purchase Contract of Sale (where the landlord is the buyer) — that's "property_document" instead.
- "agency_agreement": a signed Property Management Agreement (PMA) / agency agreement / exclusive management authority between the landlord and a real estate agency, setting out the agency's management fee, letting fee, admin fee and other ongoing terms for managing the property. Do NOT use this for a rent statement (that's "rent_statement") — this is the CONTRACT itself, not a periodic statement.
- "other": anything else (e.g. an ownership/income statement report, marketing, a general enquiry, or anything that doesn't fit the above).

Respond with your best-guess document_type and a 0-1 confidence.`;

/** A Contract of Sale reads identically whichever side you're on — "Vendor" and "Purchaser" are
 * just document roles, they don't say which one is *this* landlord. Cross-referencing the
 * landlord's own known legal names against those roles is a far more reliable signal than asking
 * the model to guess from document content alone (which otherwise defaults toward "sale"). */
function buildClassifyPrompt(knownEntityNames: string[]): string {
  if (knownEntityNames.length === 0) return CLASSIFY_PROMPT_BASE;
  return `${CLASSIFY_PROMPT_BASE}

For "property_sale" vs. "property_document" specifically: this landlord's own known legal
names/entities are: ${knownEntityNames.join(", ")}. On a Contract of Sale, check which side —
Vendor/Seller or Purchaser/Buyer — matches (even loosely/partially) one of these names, and
classify accordingly: matches the Vendor/Seller side → "property_sale"; matches the
Purchaser/Buyer side → "property_document" (a purchase). If neither side clearly matches, fall
back to your best judgement from context.`;
}

const CLASSIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    document_type: {
      type: "STRING",
      enum: [
        "bill",
        "lease_agreement",
        "rent_statement",
        "property_document",
        "depreciation_report",
        "loan_document",
        "loan_statement",
        "bank_statement",
        "property_sale",
        "agency_agreement",
        "other",
      ],
    },
    confidence: { type: "NUMBER" },
  },
  required: ["document_type", "confidence"],
};

export async function classifyDocument(
  input: NormalizedBillInput,
  knownEntityNames: string[] = [],
): Promise<ClassificationResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(buildClassifyPrompt(knownEntityNames), input);
  return callGeminiJSON<ClassificationResult>(apiKey, parts, CLASSIFY_SCHEMA);
}
