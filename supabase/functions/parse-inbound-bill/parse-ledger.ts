import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedLedgerFields, ProposalParseResult } from "./types.ts";
import { isDuplicateEmailMessageId, findByEmailMessageId } from "./idempotency.ts";

const LEDGER_PROMPT = `You are extracting rent payment transactions from a rent statement/ledger for an Australian rental property. This may come as a narrative remittance advice from a managing agent, OR as a spreadsheet-style weekly table a landlord keeps themselves (columns like Week Start Date, Week End Date, Rent Due, Rent Paid, Paid Date, Balance, Status). Handle both shapes.
Extract the fields defined in the response schema as strict JSON.
- transactions is every individual rent payment actually recorded: date (YYYY-MM-DD), amount (the rent payment amount, positive number), a short description, and tenantName.
- tenantName on a transaction is REQUIRED as a key but its value is nullable — set it to the specific tenant's name ONLY when this statement covers a tenant changeover (an outgoing tenant and an incoming tenant both paying rent within the same period, e.g. two different names appear against different payment rows) and this particular row is clearly attributable to one of them. Leave it null when the whole statement is for a single tenant (the common case) — the top-level tenantName field already covers that.
- If the source is a weekly table: emit ONE transaction per row where "Rent Paid" (or equivalent) has an actual non-blank, non-zero amount — use that row's Week Start Date (or Paid Date if present) as the transaction date. SKIP rows where the paid amount is blank/zero, even if a "Status" column says "paid" — a blank amount is not a confirmed transaction, regardless of what an adjacent status label claims.
- A single row's paid amount may be larger than one week's normal rent (a lump-sum catch-up payment covering several weeks, e.g. $5000 against a $900/week rent) — extract it as ONE transaction for that row's date and its full amount; do not try to split it across multiple weeks.
- Do NOT put agent fees, deductions, or bills paid on the owner's behalf into transactions — those go in expenseLines instead (see below). transactions is rent income only.
- expenseLines is REQUIRED — always include it, even as an empty array [] when there's nothing to report. A managing agent's ownership/disbursement statement typically deducts its own management fee, and sometimes pays a bill on the owner's behalf before remitting the balance — extract each such deduction as one expenseLine: vendor (who it was paid to — the agent itself for its own fee, or the actual biller for a bill they paid), amount (positive number), date (YYYY-MM-DD), description, and category (a short free-text tax category like "management_fees" or "water_rates").
- Decide income vs. deduction ONLY from which section of the statement a line is actually printed under (a "Receipts"/"Money In"/"Rent Received" section vs. a "Payments"/"Deductions"/"Disbursements"/"Paid on your behalf" section, or which column — credit vs. debit — it falls in on a single combined table) — never from the vendor name or wording alone. A water-usage line, for example, can legitimately be either direction on different statements: the agent invoicing and collecting a usage recharge FROM the tenant (money IN, increases what's remitted to the owner — goes in transactions) is the opposite of the agent paying the water retailer directly ON THE OWNER'S BEHALF (money OUT, reduces what's remitted — goes in expenseLines). Read the statement's own layout for each line rather than assuming from what it's about.
- netToOwner is the statement's own stated net amount actually paid/remitted to the owner this period, if shown (often labelled "Net to owner", "Amount paid to you", or similar) — null if not stated. It's used only as a reconciliation sanity check, not written anywhere directly.
- openingBalance and closingBalance: many agent statements carry a running balance the agent holds (e.g. "Balance brought forward $200" ... "Balance carried forward $150") separate from this period's own rent/expense activity — extract these two figures when shown, else null for either/both. When present, netToOwner is expected to equal (rent income − expenseLines) + openingBalance − closingBalance, NOT just rent income minus expenseLines alone — do not fold a balance rollover into netToOwner itself or invent one when the statement shows no such balance line.
- periodStart, periodEnd should be the statement's covering period in YYYY-MM-DD, or null if not stated.
- tenantName (top-level) should be the tenant's name if the whole statement is for one tenant, else null (e.g. leave this null too on a changeover statement covering two tenants — rely on each transaction's own tenantName instead).
- document_date: the statement's own issue/print date, distinct from periodStart/periodEnd — null if not stated.
- managing_agent_name: the agency issuing the statement, if any — null if this looks self-managed.
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
          tenantName: { type: "STRING", nullable: true },
        },
        required: ["date", "amount", "description", "tenantName"],
      },
    },
    expenseLines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          vendor: { type: "STRING" },
          amount: { type: "NUMBER" },
          date: { type: "STRING" },
          description: { type: "STRING" },
          category: { type: "STRING" },
        },
        required: ["vendor", "amount", "date", "description", "category"],
      },
    },
    netToOwner: { type: "NUMBER", nullable: true },
    openingBalance: { type: "NUMBER", nullable: true },
    closingBalance: { type: "NUMBER", nullable: true },
    property_address: { type: "STRING" },
    document_date: { type: "STRING", nullable: true },
    managing_agent_name: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["transactions", "expenseLines", "property_address", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedLedgerFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(LEDGER_PROMPT, input);
  return callGeminiJSON<ParsedLedgerFields>(apiKey, parts, LEDGER_SCHEMA);
}

function validateParsed(parsed: ParsedLedgerFields): string | null {
  const hasTransactions = Array.isArray(parsed.transactions) && parsed.transactions.length > 0;
  const hasExpenseLines = Array.isArray(parsed.expenseLines) && parsed.expenseLines.length > 0;
  if (!hasTransactions && !hasExpenseLines) {
    return "No transactions or expense lines found";
  }
  for (const t of parsed.transactions ?? []) {
    if (typeof t.amount !== "number" || !(t.amount > 0)) return "Invalid transaction amount";
    if (!t.date) return "Invalid transaction date";
  }
  for (const e of parsed.expenseLines ?? []) {
    if (typeof e.amount !== "number" || !(e.amount > 0)) return "Invalid expense line amount";
    if (!e.date) return "Invalid expense line date";
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
    documentDate: parsed.document_date ?? undefined,
    providerName: parsed.managing_agent_name ?? undefined,
    payload: {
      tenantName: parsed.tenantName ?? undefined,
      periodStart: parsed.periodStart ?? undefined,
      periodEnd: parsed.periodEnd ?? undefined,
      transactions: (parsed.transactions ?? []).map((t) => ({ ...t, tenantName: t.tenantName ?? undefined })),
      expenseLines: parsed.expenseLines ?? [],
      netToOwner: parsed.netToOwner ?? undefined,
      openingBalance: parsed.openingBalance ?? undefined,
      closingBalance: parsed.closingBalance ?? undefined,
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
