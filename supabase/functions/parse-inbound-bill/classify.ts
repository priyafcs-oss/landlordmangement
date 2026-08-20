import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { ClassificationResult, NormalizedBillInput } from "./types.ts";

const CLASSIFY_PROMPT = `You are triaging an email forwarded to a landlord's property-management inbox. Classify it into exactly one of these categories:
- "bill": an invoice/bill for a property expense (council rates, water, strata, insurance, electricity, gas, or similar) stating an amount owed and a due date — i.e. something currently payable.
- "lease_agreement": a residential tenancy/lease agreement, or a lease renewal, naming a tenant, rent amount, and lease dates.
- "rent_statement": a rent statement, ledger, or remittance advice from a managing AGENT listing rent payments/transactions over a period, usually with a management fee deducted. Do NOT use this for a landlord's own personal/business bank account statement — that's "bank_statement" instead.
- "property_document": a document that describes the PROPERTY ITSELF rather than something currently payable — a purchase/settlement statement, a conveyancer's settlement figures, a PEXA settlement completion record or Statement of Adjustments, a Certificate/Title, an insurance certificate of currency or policy schedule, a strata/owners-corporation notice showing the levy amount, or a compliance certificate (smoke alarm, electrical safety, gas safety, pool/barrier). Use this even if the document also mentions a dollar figure, as long as it's describing an ownership/policy/levy/compliance detail rather than an invoice due now.
- "depreciation_report": a tax depreciation schedule/report from a quantity surveyor, listing depreciable plant & equipment or capital works items with costs and effective lives (often titled "Tax Depreciation Schedule" or similar).
- "loan_document": an initial loan/mortgage offer, contract, or approval letter from a lender — establishes a NEW loan (lender, amount, rate, repayment).
- "loan_statement": an ONGOING periodic statement from a lender on an EXISTING loan/mortgage, showing interest charged, repayments made, and the closing balance over a period.
- "bank_statement": a landlord's own personal or business bank/transaction account statement (not a managing agent's rent statement) listing a list of transactions over a period.
- "property_sale": a Contract of Sale where the LANDLORD is the seller/vendor (disposing of the property), a real estate agent's commission invoice for a sale, or a settlement statement on sale showing proceeds and selling costs. Distinguish from a purchase Contract of Sale (where the landlord is the buyer) — that's "property_document" instead.
- "other": anything else (e.g. an ownership/income statement report, marketing, a general enquiry, or anything that doesn't fit the above).

Respond with your best-guess document_type and a 0-1 confidence.`;

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
        "other",
      ],
    },
    confidence: { type: "NUMBER" },
  },
  required: ["document_type", "confidence"],
};

export async function classifyDocument(input: NormalizedBillInput): Promise<ClassificationResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(CLASSIFY_PROMPT, input);
  return callGeminiJSON<ClassificationResult>(apiKey, parts, CLASSIFY_SCHEMA);
}
