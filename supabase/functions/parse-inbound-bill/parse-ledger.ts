import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedLedgerFields, ProposalParseResult } from "./types.ts";

const LEDGER_PROMPT = `You are extracting rent payment transactions from a rent statement/ledger for an Australian rental property. This may come as a narrative remittance advice from a managing agent, OR as a spreadsheet-style weekly table a landlord keeps themselves (columns like Week Start Date, Week End Date, Rent Due, Rent Paid, Paid Date, Balance, Status). Handle both shapes.
Extract the fields defined in the response schema as strict JSON.
- transactions is every individual rent payment actually recorded: date (YYYY-MM-DD), amount (the rent payment amount, positive number), and a short description.
- If the source is a weekly table: emit ONE transaction per row where "Rent Paid" (or equivalent) has an actual non-blank, non-zero amount — use that row's Week Start Date (or Paid Date if present) as the transaction date. SKIP rows where the paid amount is blank/zero, even if a "Status" column says "paid" — a blank amount is not a confirmed transaction, regardless of what an adjacent status label claims.
- A single row's paid amount may be larger than one week's normal rent (a lump-sum catch-up payment covering several weeks, e.g. $5000 against a $900/week rent) — extract it as ONE transaction for that row's date and its full amount; do not try to split it across multiple weeks.
- Do not include agent fees, deductions, or a net-remittance total as a transaction — only the tenant's actual rent payments.
- periodStart, periodEnd should be the statement's covering period in YYYY-MM-DD, or null if not stated.
- tenantName should be the tenant's name if stated, else null.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is, based on how clearly each field was stated in the source. Use 1.0 only when every field was explicit and unambiguous; lower it when you had to infer or guess.`;

const LEDGER_SCHEMA = {
  type: "OBJECT",
  properties: {
    tenantName: { type: "STRING", nullable: true },
    periodStart: { type: "STRING", nullable: true },
    periodEnd: { type: "STRING", nullable: true },
    transactions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          amount: { type: "NUMBER" },
          description: { type: "STRING" },
        },
        required: ["date", "amount", "description"],
      },
    },
    property_address: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["transactions", "property_address", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedLedgerFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(LEDGER_PROMPT, input);
  return callGeminiJSON<ParsedLedgerFields>(apiKey, parts, LEDGER_SCHEMA);
}

function validateParsed(parsed: ParsedLedgerFields): string | null {
  if (!Array.isArray(parsed.transactions) || parsed.transactions.length === 0) {
    return "No transactions found";
  }
  for (const t of parsed.transactions) {
    if (typeof t.amount !== "number" || !(t.amount > 0)) return "Invalid transaction amount";
    if (!t.date) return "Invalid transaction date";
  }
  return null;
}

/** Best-effort tenant match: unambiguous if the property has exactly one tenant, or the
 * extracted tenant name matches one tenant at that property. Left null otherwise — the
 * landlord always picks in the review UI before anything is written. */
async function matchTenant(
  supabase: SupabaseClient,
  propertyId: string | null,
  tenantName: string | null,
): Promise<string | null> {
  if (!propertyId) return null;
  const { data: tenants } = await supabase.from("tenants").select("id, name").eq("propertyId", propertyId);
  if (!tenants || tenants.length === 0) return null;
  if (tenants.length === 1) return tenants[0].id;
  if (tenantName) {
    const q = tenantName.trim().toLowerCase();
    const match = tenants.find((t: { id: string; name: string }) => t.name.trim().toLowerCase() === q);
    if (match) return match.id;
  }
  return null;
}

export async function parseRentStatement(
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

  let parsed: ParsedLedgerFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  const validationError = validateParsed(parsed);
  if (validationError) return { ok: false, error: validationError };

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");
  const matchedTenantId = await matchTenant(supabase, matchedPropertyId, parsed.tenantName);

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "rent_ledger",
    status: "pending",
    propertyId: matchedPropertyId,
    matchedTenantId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    payload: {
      tenantName: parsed.tenantName ?? undefined,
      periodStart: parsed.periodStart ?? undefined,
      periodEnd: parsed.periodEnd ?? undefined,
      transactions: parsed.transactions,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

  return { ok: true, proposalId: row.id };
}
