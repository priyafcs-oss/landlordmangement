import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { classifyDocument } from "./classify.ts";
import { parseInboundBill } from "./core-parser.ts";
import { parseLeaseAgreement } from "./parse-lease.ts";
import { parseRentStatement } from "./parse-ledger.ts";
import { parsePropertyDocument } from "./parse-property-document.ts";
import type { NormalizedBillInput, ParseResult, ProposalParseResult } from "./types.ts";

export type RouteResult = (ParseResult | ProposalParseResult) & { skipped?: boolean };

/**
 * Classifies the inbound document, then dispatches to the type-specific extractor.
 * "other" (the common case — landlords forward all sorts of things) is a silent
 * no-op, not an error: there's nothing wrong with the email, there's just nothing to do.
 */
export async function routeInboundDocument(
  supabase: SupabaseClient,
  input: NormalizedBillInput,
  emailMessageId: string | null,
): Promise<RouteResult> {
  let classification;
  try {
    classification = await classifyDocument(input);
  } catch (e) {
    // Unlike every downstream extractor, classification previously had no guard here — a
    // Gemini failure (bad/oversized attachment, quota, transient outage) propagated all the way
    // up as an unhandled exception, surfacing to the webhook caller as an opaque 500 instead of
    // a clear, retriable-looking 422 with the actual reason.
    const error = e instanceof Error ? e.message : "Document classification failed";
    console.error(`[parse-inbound-bill] classification failed for "${input.pdfFileName ?? "(no attachment)"}": ${error}`);
    return { ok: false, error: `Classification failed: ${error}` };
  }

  switch (classification.document_type) {
    case "bill":
      return parseInboundBill(supabase, input, emailMessageId);
    case "lease_agreement":
      return parseLeaseAgreement(supabase, input, emailMessageId);
    case "rent_statement":
      return parseRentStatement(supabase, input, emailMessageId);
    case "property_document":
      return parsePropertyDocument(supabase, input, emailMessageId);
    default:
      console.log(`[parse-inbound-bill] classified as "other" (confidence ${classification.confidence}), skipping`);
      return { ok: true, skipped: true };
  }
}
