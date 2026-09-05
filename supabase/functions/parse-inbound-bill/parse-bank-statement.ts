import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { matchProviderInRows } from "./provider-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedBankStatementFields, ProposalParseResult } from "./types.ts";
import { isDuplicateEmailMessageId, findByEmailMessageId } from "./idempotency.ts";

const PROMPT = `You are extracting transactions from a landlord's own personal or business bank/transaction account statement — NOT a managing agent's rent statement (that's a different document type).
Extract the fields defined in the response schema as strict JSON.
- property_address: which property this account relates to, if the statement or its transactions make that clear — null if it's a general account not obviously tied to one property.
- bank_name: the bank's name, if shown.
- account_name: the account's own name/nickname as printed (e.g. "Everyday Offset", "Smith Family Trust Account") — null if the statement only shows the account holder's name, not a distinct account label.
- bsb: the BSB printed on the statement, null if not shown.
- account_number: the account number printed on the statement, null if not shown.
- period_start, period_end: YYYY-MM-DD, the statement's covering period, null if not stated.
- transactions is REQUIRED — always include it, even as an empty array [] if none can be read. Extract EVERY line item: date (YYYY-MM-DD), description (the payee/narration as printed), amount (a positive number), and direction — "in" for money received (credits/deposits) or "out" for money paid (debits/withdrawals). This is a general account, so transactions may include rent income, bills paid, transfers, or entirely unrelated personal spending — extract everything as printed, the landlord will pick which lines are relevant to this property in the review step.
- addressed_to: the account holder name printed on the statement, if shown — null if not stated. Do not guess.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    property_address: { type: "STRING", nullable: true },
    bank_name: { type: "STRING", nullable: true },
    account_name: { type: "STRING", nullable: true },
    bsb: { type: "STRING", nullable: true },
    account_number: { type: "STRING", nullable: true },
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

/** Pure Gemini extraction, no database access — shared by the classify→stage pipeline below and
 * the stateless extract-bank-statement endpoint used by Rental Hub's Bank Feed Import. */
export async function extractBankStatementFields(input: NormalizedBillInput): Promise<ParsedBankStatementFields> {
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
    parsed = await extractBankStatementFields(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  if (!parsed.transactions?.length) return { ok: false, error: "No transactions found" };

  const matchedPropertyId = parsed.property_address ? await matchProperty(supabase, parsed.property_address) : null;

  // Only outgoing lines are candidates for a vendor/provider match — an "in" line is money the
  // landlord received (rent, a transfer), which was never paid TO a provider. A match failure
  // falls back to the line's own description as a suggested (not yet directory-linked) provider
  // name, so the review UI never has to show a blank vendor field for a paid-out line. Providers
  // are fetched once up front rather than once per transaction line.
  const { data: providerRows } = await supabase.from("providers").select("id, name, abn");
  const transactions = parsed.transactions.map((t) => {
    if (t.direction !== "out") return t;
    const providerId = matchProviderInRows(providerRows ?? [], t.description);
    return {
      ...t,
      providerId,
      suggestedProviderName: providerId ? undefined : t.description.trim() || undefined,
    };
  });

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "bank_statement",
    status: "pending",
    propertyId: matchedPropertyId,
    bankAccountId: input.bankAccountIdHint,
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
      accountName: parsed.account_name ?? undefined,
      bsb: parsed.bsb ?? undefined,
      accountNumber: parsed.account_number ?? undefined,
      periodStart: parsed.period_start ?? undefined,
      periodEnd: parsed.period_end ?? undefined,
      transactions,
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
