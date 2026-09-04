import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedLoanStatementFields, ProposalParseResult } from "./types.ts";
import { isDuplicateEmailMessageId, findByEmailMessageId } from "./idempotency.ts";

const PROMPT = `You are extracting figures from an ONGOING periodic loan/mortgage statement forwarded to an Australian landlord — an existing loan, not a new one.
Extract the fields defined in the response schema as strict JSON.
- property_address: the property this loan is secured against.
- lender_name: the bank/lender's name.
- period_start, period_end: YYYY-MM-DD, the statement's covering period, null if not stated.
- line_items: THIS IS THE MOST IMPORTANT FIELD. List every distinct interest-charge/repayment event shown in the statement's transaction table, each as its own entry with its OWN actual date (the date printed against that line, e.g. "01 Jun", "01 Jul", "01 Aug" — NOT the statement's period_start/period_end or print date). If the statement covers several months (a quarterly, half-yearly, or multi-month statement), you MUST return one line_items entry per month/period shown — never collapse multiple months into a single aggregated figure. For each entry: date (YYYY-MM-DD), interest_charged (that period's interest portion), principal_paid (that period's principal portion, distinct from interest — null if the statement doesn't break it out for that line), repayment_amount (the full amount debited that period, interest+principal, if a repayment happened that period, else null), balance_after (the running balance immediately after that line, if the statement shows it). If the statement genuinely gives only one period total with no per-date breakdown at all, return a single line_items entry dated period_end (or the statement's document date) with that one total.
- interest_charged, repayments_made: the TOTAL amounts over this whole statement period, summed across all line_items — null if not stated.
- principal_paid: the total portion of repayments_made that reduced the principal over this whole period, distinct from interest_charged — null if not stated or not broken out separately.
- closing_balance: the loan's outstanding balance at the end of this statement (should match the last line_item's balance_after when both are known), null if not stated.
- emi_amount_due: the fixed repayment amount due each period going forward (the EMI/instalment amount), null if not stated.
- next_emi_due_date: YYYY-MM-DD, the next scheduled repayment date, null if not stated.
- account_number_last4: the last 4 digits of the loan/account number printed on the statement, null if not shown.
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
    line_items: {
      type: "ARRAY",
      nullable: true,
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          interest_charged: { type: "NUMBER", nullable: true },
          principal_paid: { type: "NUMBER", nullable: true },
          repayment_amount: { type: "NUMBER", nullable: true },
          balance_after: { type: "NUMBER", nullable: true },
        },
        required: ["date"],
      },
    },
    interest_charged: { type: "NUMBER", nullable: true },
    repayments_made: { type: "NUMBER", nullable: true },
    principal_paid: { type: "NUMBER", nullable: true },
    closing_balance: { type: "NUMBER", nullable: true },
    emi_amount_due: { type: "NUMBER", nullable: true },
    next_emi_due_date: { type: "STRING", nullable: true },
    account_number_last4: { type: "STRING", nullable: true },
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

  // A loanIdHint (from the "Upload statement to this loan" button) already tells us exactly
  // which loan/property this is for — deterministic, skipping the fuzzy address/lender matching
  // below, which stays for the ordinary email/global-upload path where no hint exists.
  let matchedPropertyId: string | null = null;
  let matchedLoanId: string | null = null;
  if (input.loanIdHint) {
    const { data: loan } = await supabase.from("loans").select("id, propertyId").eq("id", input.loanIdHint).maybeSingle();
    if (loan) {
      matchedLoanId = loan.id;
      matchedPropertyId = loan.propertyId ?? null;
    }
  }
  if (!matchedLoanId) {
    matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");
    matchedLoanId = await matchLoan(supabase, matchedPropertyId, parsed.lender_name);
  }

  const lineItems = (parsed.line_items ?? [])
    .filter((li) => !!li.date)
    .map((li) => ({
      date: li.date,
      interestCharged: li.interest_charged ?? undefined,
      principalPaid: li.principal_paid ?? undefined,
      repaymentAmount: li.repayment_amount ?? undefined,
      balanceAfter: li.balance_after ?? undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // The per-statement totals are only a display/history fallback for proposals with no
  // per-date breakdown at all — when line_items came back, sum from those instead of trusting
  // Gemini's separately-generated aggregate fields, so the two can never disagree.
  const sumOr = (field: "interestCharged" | "principalPaid" | "repaymentAmount", fallback: number | null) =>
    lineItems.length > 0
      ? lineItems.reduce((s, li) => s + (li[field] ?? 0), 0) || undefined
      : (fallback ?? undefined);

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
      lineItems,
      interestCharged: sumOr("interestCharged", parsed.interest_charged),
      repaymentsMade: sumOr("repaymentAmount", parsed.repayments_made),
      principalPaid: sumOr("principalPaid", parsed.principal_paid),
      closingBalance: lineItems.at(-1)?.balanceAfter ?? parsed.closing_balance ?? undefined,
      emiAmountDue: parsed.emi_amount_due ?? undefined,
      nextEmiDueDate: parsed.next_emi_due_date ?? undefined,
      accountNumberLast4: parsed.account_number_last4 ?? undefined,
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
