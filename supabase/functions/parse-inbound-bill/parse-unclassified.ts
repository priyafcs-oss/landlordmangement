import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { NormalizedBillInput, ProposalParseResult } from "./types.ts";

/**
 * Stages a document Gemini couldn't classify into any known type (a trust deed, a compliance
 * certificate, a loan statement — anything this pipeline doesn't have a dedicated parser for yet)
 * as a minimal "unclassified" proposal, instead of silently dropping it. Only called when there's
 * an actual attachment — a marketing email or a general enquiry with no attachment stays a no-op,
 * since staging those would just spam the approval queue. No extraction is attempted here; the
 * landlord assigns a property (or not) and files it straight into Documents from the review card.
 */
export async function stageUnclassifiedDocument(
  supabase: SupabaseClient,
  input: NormalizedBillInput,
  emailMessageId: string | null,
  confidence: number,
): Promise<ProposalParseResult> {
  if (emailMessageId) {
    const { data: existing } = await supabase
      .from("ai_intake_proposals")
      .select("id")
      .eq("emailMessageId", emailMessageId)
      .maybeSingle();
    if (existing) return { ok: true, proposalId: existing.id };
  }

  const row = {
    id: `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: "unclassified",
    status: "pending",
    sourceSubject: input.subject,
    emailMessageId,
    sourceFileName: input.pdfFileName,
    sourceFileData: input.pdfBase64,
    sourceEmailBody: input.textBody,
    payload: {
      documentCategory: input.subject || input.pdfFileName || "Unrecognised document",
      confidence,
    },
  };

  const { error } = await supabase.from("ai_intake_proposals").insert(row);
  if (error) return { ok: false, error: error.message };

  return { ok: true, proposalId: row.id };
}
