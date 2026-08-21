import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedLoanStatementFields, ProposalParseResult } from "./types.ts";

const PROMPT = `You are extracting figures from an ONGOING periodic loan/mortgage statement forwarded to an Australian landlord — an existing loan, not a new one.
Extract the fields defined in the response schema as strict JSON.
- property_address: the property this loan is secured against.
- lender_name: the bank/lender's name.
- period_start, period_end: YYYY-MM-DD, the statement's covering period, null if not stated.
- interest_charged, repayments_made: the total amounts over this statement period, null if not stated.
- closing_balance: the loan's outstanding balance at the end of this statement, null if not stated.
- document_date: the statement's own print date, distinct from period_end — null if not stated.
- addressed_to: the account holder name printed on the statement — null if not stated.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    property_address: { type: "STRING" },
    lender_name: { type: "STRING" },
    period_start: { type: "STRING", nullable: true },
    period_end: { type: "STRING", nullable: true },
    interest_charged: { type: "NUMBER", nullable: true },
    repayments_made: { type: "NUMBER", nullable: true },
    closing_balance: { type: "NUMBER", nullable: true },
    document_date: { type: "STRING", nullable: true },
    addressed_to: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["property_address", "lender_name", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedLoanStatementFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(PROMPT, input);
  return callGeminiJSON<ParsedLoanStatementFields>(apiKey, parts, SCHEMA);
}

/** Best-effort loan match: unambiguous if the property has exactly one loan, or the extracted
 * lender name matches one loan's bank name at that property. Left null otherwise — the landlord
 * always picks in the review UI before anything is written. */
async function matchLoan(
  supabase: SupabaseClient,
  propertyId: string | null,
  lenderName: string | null,
): Promise<string | null> {
  if (!propertyId) return null;
  const { data: loans } = await supabase.from("loans").select("id, bankName").eq("propertyId", propertyId);
  if (!loans || loans.length === 0) return null;
  if (loans.length === 1) return loans[0].id;
  if (lenderName) {
    const q = lenderName.trim().toLowerCase();
    const match = loans.find((l: { id: string; bankName: string }) => l.bankName.trim().toLowerCase().includes(q) || q.includes(l.bankName.trim().toLowerCase()));
    if (match) return match.id;
  }
  return null;
}

/** Stages a "loan_statement" proposal — matched against an existing Loan to update (balance,
 * interest paid), never creates a new one. Human always confirms which loan before anything writes. */
export async function parseLoanStatement(
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

  let parsed: ParsedLoanStatementFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  if (!parsed.lender_name) return { ok: false, error: "Missing lender_name" };

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");
  const matchedLoanId = await matchLoan(supabase, matchedPropertyId, parsed.lender_name);

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "loan_statement",
    status: "pending",
    propertyId: matchedPropertyId,
    matchedLoanId,
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
      periodStart: parsed.period_start ?? undefined,
      periodEnd: parsed.period_end ?? undefined,
      interestCharged: parsed.interest_charged ?? undefined,
      repaymentsMade: parsed.repayments_made ?? undefined,
      closingBalance: parsed.closing_balance ?? undefined,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

  return { ok: true, proposalId: row.id };
}
