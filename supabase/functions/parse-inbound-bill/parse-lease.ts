import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { matchProperty } from "./property-match.ts";
import { buildDocumentParts, callGeminiJSON } from "./gemini.ts";
import type { NormalizedBillInput, ParsedLeaseFields, ProposalParseResult } from "./types.ts";

const LEASE_PROMPT = `You are extracting structured tenancy data from a residential lease/rent agreement (or lease renewal) email for an Australian rental property.
Extract the fields defined in the response schema as strict JSON.
- leaseStart, leaseExpiry must be formatted YYYY-MM-DD, or null if not stated.
- leaseDuration should be "6 Months", "12 Months", or "Periodic" if it can be inferred from the dates/wording, else null.
- email, phone, bondAmount should be null if not stated.
- confidence is YOUR OWN 0-1 estimate of how certain this extraction is, based on how clearly each field was stated in the source. Use 1.0 only when every field was explicit and unambiguous; lower it when you had to infer or guess.`;

const LEASE_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    email: { type: "STRING", nullable: true },
    phone: { type: "STRING", nullable: true },
    rentAmount: { type: "NUMBER" },
    rentFrequency: { type: "STRING", enum: ["Weekly", "Fortnightly", "Monthly"] },
    leaseStart: { type: "STRING", nullable: true },
    leaseExpiry: { type: "STRING", nullable: true },
    leaseDuration: { type: "STRING", enum: ["6 Months", "12 Months", "Periodic"], nullable: true },
    bondAmount: { type: "NUMBER", nullable: true },
    property_address: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["name", "rentAmount", "rentFrequency", "property_address", "confidence"],
};

async function callGemini(input: NormalizedBillInput): Promise<ParsedLeaseFields> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const parts = buildDocumentParts(LEASE_PROMPT, input);
  return callGeminiJSON<ParsedLeaseFields>(apiKey, parts, LEASE_SCHEMA);
}

function validateParsed(parsed: ParsedLeaseFields): string | null {
  if (!parsed.name || typeof parsed.name !== "string") return "Missing tenant name";
  if (typeof parsed.rentAmount !== "number" || !(parsed.rentAmount > 0)) return "Missing or invalid rent amount";
  return null;
}

export async function parseLeaseAgreement(
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

  let parsed: ParsedLeaseFields;
  try {
    parsed = await callGemini(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini extraction failed" };
  }

  const validationError = validateParsed(parsed);
  if (validationError) return { ok: false, error: validationError };

  const matchedPropertyId = await matchProperty(supabase, parsed.property_address ?? "");

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "tenant_lease",
    status: "pending",
    propertyId: matchedPropertyId,
    rawPropertyAddress: parsed.property_address,
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    payload: {
      name: parsed.name,
      email: parsed.email ?? undefined,
      phone: parsed.phone ?? undefined,
      rentAmount: parsed.rentAmount,
      rentFrequency: parsed.rentFrequency,
      leaseStart: parsed.leaseStart ?? undefined,
      leaseExpiry: parsed.leaseExpiry ?? undefined,
      leaseDuration: parsed.leaseDuration ?? undefined,
      bondAmount: parsed.bondAmount ?? undefined,
      confidence: parsed.confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

  return { ok: true, proposalId: row.id };
}
