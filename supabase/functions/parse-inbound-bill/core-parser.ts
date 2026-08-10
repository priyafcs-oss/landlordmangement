import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import type { NormalizedBillInput, ParsedBillFields, ParseResult } from "./types.ts";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Google has been retiring Gemini model IDs for new API keys faster than their published
// deprecation dates (see the GEMINI_MODEL override below for the no-redeploy fix path).
const DEFAULT_MODEL_CANDIDATES = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];

/**
 * GEMINI_MODEL (optional secret) lets you point at a new model the moment Google retires the
 * current one, without a code change or redeploy: `supabase secrets set GEMINI_MODEL=...`.
 * If it's unset, or itself gets retired, we fall through the hardcoded candidates below.
 */
function modelCandidates(): string[] {
  const override = Deno.env.get("GEMINI_MODEL");
  const list = override ? [override, ...DEFAULT_MODEL_CANDIDATES] : DEFAULT_MODEL_CANDIDATES;
  return [...new Set(list)];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const DUPLICATE_WINDOW_DAYS = 14;
const PRICE_SPIKE_MULTIPLIER = 1.4;
const LOW_CONFIDENCE_THRESHOLD = 0.85;

async function callGemini(input: NormalizedBillInput): Promise<ParsedBillFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const parts: Record<string, unknown>[] = [
    {
      text: `You are extracting structured invoice data from an Australian property bill email (council rates, water, strata, or similar).
Extract the fields defined in the response schema as strict JSON.
- due_date must be formatted YYYY-MM-DD.
- bpay_biller_code and bpay_reference must be null if the bill has no BPAY details.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is, based on how clearly each field was stated in the source. Use 1.0 only when every field was explicit and unambiguous; lower it when you had to infer or guess.

Subject: ${input.subject}
From: ${input.fromEmail}
Body:
${input.textBody ?? "(see attached PDF)"}`,
    },
  ];

  if (input.pdfBase64) {
    parts.push({ inlineData: { mimeType: "application/pdf", data: input.pdfBase64 } });
  }

  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          vendor: { type: "STRING" },
          amount: { type: "NUMBER" },
          due_date: { type: "STRING" },
          property_address: { type: "STRING" },
          bpay_biller_code: { type: "STRING", nullable: true },
          bpay_reference: { type: "STRING", nullable: true },
          ato_category: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: ["vendor", "amount", "due_date", "property_address", "ato_category", "confidence"],
      },
    },
  });

  const candidates = modelCandidates();
  let lastError = "unknown error";

  for (const model of candidates) {
    const res = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    if (res.ok) {
      if (model !== candidates[0]) {
        console.warn(
          `[parse-inbound-bill] Gemini model "${candidates[0]}" is unavailable; used fallback "${model}". Update the GEMINI_MODEL secret before the fallback also breaks.`,
        );
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini returned no content");
      return JSON.parse(text) as ParsedBillFields;
    }

    lastError = `${res.status} ${await res.text()}`;
    // Only fall through to the next candidate when the model itself was retired (404) — any
    // other failure (bad key, quota, malformed request) is a real bug, not a model-rot issue.
    if (res.status !== 404) {
      throw new Error(`Gemini request failed: ${lastError}`);
    }
    console.warn(`[parse-inbound-bill] Gemini model "${model}" unavailable (404), trying next candidate`);
  }

  throw new Error(`Gemini request failed on all model candidates: ${lastError}`);
}

function validateParsed(parsed: ParsedBillFields): string | null {
  if (!parsed.vendor || typeof parsed.vendor !== "string") return "Missing vendor";
  if (typeof parsed.amount !== "number" || !(parsed.amount > 0)) return "Missing or invalid amount";
  if (!DATE_RE.test(parsed.due_date ?? "")) return "Missing or invalid due_date";
  return null;
}

/** Maps Gemini's free-text ato_category onto the app's existing two-value tax category union. */
function mapAtoCategory(category: string): "Immediate Deduction" | "Capital Works" {
  const c = (category ?? "").toLowerCase();
  if (c.includes("capital") || c.includes("improvement") || c.includes("renovation")) {
    return "Capital Works";
  }
  return "Immediate Deduction";
}

async function runGuardrails(
  supabase: SupabaseClient,
  parsed: ParsedBillFields,
  matchedPropertyId: string | null,
): Promise<{ status: "approved" | "needs_review"; reviewReason: string | null }> {
  const reasons: string[] = [];

  const dueDate = new Date(parsed.due_date);
  const from = new Date(dueDate.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(dueDate.getTime() + DUPLICATE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

  const { data: dupeByVendor } = await supabase
    .from("expenses")
    .select("id")
    .ilike("itemName", parsed.vendor)
    .gte("date", from)
    .lte("date", to)
    .limit(1);

  let isDuplicate = (dupeByVendor?.length ?? 0) > 0;

  if (!isDuplicate && parsed.bpay_reference) {
    const { data: dupeByRef } = await supabase
      .from("expenses")
      .select("id")
      .eq("bpayReference", parsed.bpay_reference)
      .limit(1);
    isDuplicate = (dupeByRef?.length ?? 0) > 0;
  }

  if (isDuplicate) reasons.push("Possible Duplicate");

  const { data: history } = await supabase
    .from("expenses")
    .select("cost")
    .ilike("itemName", parsed.vendor);

  if (history && history.length > 0) {
    const avg = history.reduce((s: number, r: { cost: number }) => s + Number(r.cost), 0) / history.length;
    if (avg > 0 && parsed.amount > avg * PRICE_SPIKE_MULTIPLIER) {
      reasons.push("Price Spike Detected");
    }
  }

  if (parsed.confidence < LOW_CONFIDENCE_THRESHOLD || !matchedPropertyId) {
    reasons.push("Low Confidence / Unmatched Property");
  }

  return {
    status: reasons.length > 0 ? "needs_review" : "approved",
    reviewReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

export async function parseInboundBill(
  supabase: SupabaseClient,
  input: NormalizedBillInput,
  emailMessageId: string | null,
): Promise<ParseResult> {
  if (emailMessageId) {
    const { data: existing } = await supabase
      .from("expenses")
      .select("id")
      .eq("emailMessageId", emailMessageId)
      .maybeSingle();
    if (existing) {
      return { ok: true, expenseId: existing.id };
    }
  }

  let parsed: ParsedBillFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  const validationError = validateParsed(parsed);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "", parsed.bpay_reference);
  const { status, reviewReason } = await runGuardrails(supabase, parsed, matchedPropertyId);

  const row = {
    id: `ex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    itemName: parsed.vendor,
    cost: parsed.amount,
    date: parsed.due_date,
    propertyId: matchedPropertyId,
    taxCategory: mapAtoCategory(parsed.ato_category),
    hasWarranty: false,
    rechargeToTenant: false,
    status,
    source: "email_auto",
    bpayBillerCode: parsed.bpay_biller_code,
    bpayReference: parsed.bpay_reference,
    rawPropertyAddress: parsed.property_address,
    emailMessageId,
    reviewReason,
  };

  const { error } = await supabase.from("expenses").insert(row);
  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, expenseId: row.id, status, reviewReason, matchedPropertyId };
}
