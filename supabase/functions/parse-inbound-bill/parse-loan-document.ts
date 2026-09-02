import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedLoanDocumentFields, ProposalParseResult } from "./types.ts";
import { isDuplicateEmailMessageId, findByEmailMessageId } from "./idempotency.ts";

const PROMPT = `You are extracting loan details from an initial mortgage/loan document (offer, contract, or approval letter) forwarded to an Australian landlord — this establishes a NEW loan, not an ongoing statement.
Extract the fields defined in the response schema as strict JSON.
- property_address: the property this loan is secured against.
- lender_name: the bank/lender's name.
- loan_amount, interest_rate (as a percentage, e.g. 6.25 not 0.0625), monthly_repayment: null if not stated.
- start_date: YYYY-MM-DD, null if not stated.
- has_offset_account: true/false if the document mentions an offset account attached to this loan, else null.
- document_date: the document's own date, distinct from start_date (loan commencement can post-date the document) — null if not stated.
- addressed_to: the borrower's name as printed — null if not stated.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    property_address: { type: "STRING" },
    lender_name: { type: "STRING" },
    loan_amount: { type: "NUMBER", nullable: true },
    interest_rate: { type: "NUMBER", nullable: true },
    monthly_repayment: { type: "NUMBER", nullable: true },
    start_date: { type: "STRING", nullable: true },
    has_offset_account: { type: "BOOLEAN", nullable: true },
    document_date: { type: "STRING", nullable: true },
    addressed_to: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["property_address", "lender_name", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedLoanDocumentFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(PROMPT, input);
  return callGeminiJSON<ParsedLoanDocumentFields>(apiKey, parts, SCHEMA);
}

/** Stages a "loan_document" proposal — always needs human confirmation before creating a new Loan record. */
export async function parseLoanDocument(
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

  let parsed: ParsedLoanDocumentFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  if (!parsed.lender_name) return { ok: false, error: "Missing lender_name" };

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "loan_document",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    documentDate: parsed.document_date ?? undefined,
    providerName: parsed.lender_name,
    addressedTo: parsed.addressed_to ?? undefined,
    payload: {
      lenderName: parsed.lender_name,
      loanAmount: parsed.loan_amount ?? undefined,
      interestRate: parsed.interest_rate ?? undefined,
      monthlyRepayment: parsed.monthly_repayment ?? undefined,
      startDate: parsed.start_date ?? undefined,
      hasOffsetAccount: parsed.has_offset_account ?? undefined,
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
