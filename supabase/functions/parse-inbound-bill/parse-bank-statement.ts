import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedBankStatementFields, ProposalParseResult } from "./types.ts";

const PROMPT = `You are extracting transactions from a landlord's own personal or business bank/transaction account statement — NOT a managing agent's rent statement (that's a different document type).
Extract the fields defined in the response schema as strict JSON.
- property_address: which property this account relates to, if the statement or its transactions make that clear — null if it's a general account not obviously tied to one property.
- bank_name: the bank's name, if shown.
- period_start, period_end: YYYY-MM-DD, the statement's covering period, null if not stated.
- transactions is REQUIRED — always include it, even as an empty array [] if none can be read. Extract EVERY line item: date (YYYY-MM-DD), description (the payee/narration as printed), amount (a positive number), and direction — "in" for money received (credits/deposits) or "out" for money paid (debits/withdrawals). This is a general account, so transactions may include rent income, bills paid, transfers, or entirely unrelated personal spending — extract everything as printed, the landlord will pick which lines are relevant to this property in the review step.
- addressed_to: the account holder name printed on the statement, if shown — null if not stated. Do not guess.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    property_address: { type: "STRING", nullable: true },
    bank_name: { type: "STRING", nullable: true },
    period_start: { type: "STRING", nullable: true },
    period_end: { type: "STRING", nullable: true },
    addressed_to: { type: "STRING", nullable: true },
    transactions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          description: { type: "STRING" },
          amount: { type: "NUMBER" },
          direction: { type: "STRING", enum: ["in", "out"] },
        },
        required: ["date", "description", "amount", "direction"],
      },
    },
    confidence: { type: "NUMBER" },
  },
  required: ["transactions", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedBankStatementFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(PROMPT, input);
  return callGeminiJSON<ParsedBankStatementFields>(apiKey, parts, SCHEMA);
}

/** Stages a "bank_statement" proposal — every line reviewed individually since a general account
 * can mix multiple properties or unrelated spending; nothing is auto-applied. */
export async function parseBankStatement(
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

  let parsed: ParsedBankStatementFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  if (!parsed.transactions?.length) return { ok: false, error: "No transactions found" };

  const matchedPropertyId = parsed.property_address ? await matchProperty(supabase, parsed.property_address) : null;

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "bank_statement",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address ?? undefined,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    providerName: parsed.bank_name ?? undefined,
    addressedTo: parsed.addressed_to ?? undefined,
    payload: {
      bankName: parsed.bank_name ?? undefined,
      periodStart: parsed.period_start ?? undefined,
      periodEnd: parsed.period_end ?? undefined,
      transactions: parsed.transactions,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

  return { ok: true, proposalId: row.id };
}
