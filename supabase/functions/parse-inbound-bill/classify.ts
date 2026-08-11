import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { ClassificationResult, NormalizedBillInput } from "./types.ts";

const CLASSIFY_PROMPT = `You are triaging an email forwarded to a landlord's property-management inbox. Classify it into exactly one of these categories:
- "bill": an invoice/bill for a property expense (council rates, water, strata, insurance, electricity, gas, or similar) stating an amount owed and a due date.
- "lease_agreement": a residential tenancy/lease agreement, or a lease renewal, naming a tenant, rent amount, and lease dates.
- "rent_statement": a rent statement, ledger, or remittance advice from a managing agent listing rent payments/transactions over a period.
- "other": anything else (e.g. an ownership/income statement report, marketing, a general enquiry, or anything that doesn't fit the above).

Respond with your best-guess document_type and a 0-1 confidence.`;

const CLASSIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    document_type: { type: "STRING", enum: ["bill", "lease_agreement", "rent_statement", "other"] },
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
