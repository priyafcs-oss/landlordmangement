import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { classifyDocument } from "./classify.ts";
import { parseInboundBill } from "./core-parser.ts";
import { parseLeaseAgreement } from "./parse-lease.ts";
import { parseRentStatement } from "./parse-ledger.ts";
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
  const classification = await classifyDocument(input);

  switch (classification.document_type) {
    case "bill":
      return parseInboundBill(supabase, input, emailMessageId);
    case "lease_agreement":
      return parseLeaseAgreement(supabase, input, emailMessageId);
    case "rent_statement":
      return parseRentStatement(supabase, input, emailMessageId);
    default:
      console.log(`[parse-inbound-bill] classified as "other" (confidence ${classification.confidence}), skipping`);
      return { ok: true, skipped: true };
  }
}
