import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { parseInboundBill } from "../parse-inbound-bill/parse-bill.ts";
import { parseLeaseAgreement } from "../parse-inbound-bill/parse-lease.ts";
import { parseRentStatement } from "../parse-inbound-bill/parse-ledger.ts";
import { parsePropertyDocument } from "../parse-inbound-bill/parse-property-document.ts";
import { parseDepreciationReport } from "../parse-inbound-bill/parse-depreciation-report.ts";
import { parseLoanDocument } from "../parse-inbound-bill/parse-loan-document.ts";
import { parseLoanStatement } from "../parse-inbound-bill/parse-loan-statement.ts";
import { parseBankStatement } from "../parse-inbound-bill/parse-bank-statement.ts";
import { parsePropertySale } from "../parse-inbound-bill/parse-property-sale.ts";
import type { NormalizedBillInput, ParseResult, ProposalParseResult } from "../parse-inbound-bill/types.ts";

interface ReparseRequest {
  proposalId?: string;
  documentType?: string;
}

function inferMimeType(fileName?: string): string {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (["png", "gif", "webp", "heic"].includes(ext)) return `image/${ext}`;
  return "application/pdf";
}

/**
 * Lets a landlord tell the app "this unclassified upload is actually a lease / rent statement /
 * etc" and re-run extraction with that specific type's parser — reuses the exact same DB-writing
 * parsers the email/upload pipeline already dispatches to per DocumentType (see router.ts),
 * just chosen by the landlord instead of guessed by Gemini's classification step. On success the
 * original unclassified proposal row is deleted (only after the replacement is confirmed written,
 * so a failed re-parse never leaves neither the original nor a usable result).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: ReparseRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.proposalId || !body.documentType) {
    return new Response(JSON.stringify({ error: "proposalId and documentType are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: existing, error: loadError } = await supabase
    .from("ai_intake_proposals")
    .select("*")
    .eq("id", body.proposalId)
    .maybeSingle();
  if (loadError || !existing) {
    return new Response(JSON.stringify({ error: "Original document not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!existing.sourceFileData) {
    return new Response(JSON.stringify({ error: "No source file on this document to re-read" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const input: NormalizedBillInput = {
    fromEmail: "manual-upload",
    subject: existing.sourceSubject || existing.sourceFileName || "Re-parsed document",
    pdfBase64: existing.sourceFileData,
    pdfFileName: existing.sourceFileName ?? undefined,
    attachmentMimeType: inferMimeType(existing.sourceFileName),
    textBody: existing.sourceEmailBody ?? undefined,
  };

  let result: ParseResult | ProposalParseResult;
  try {
    switch (body.documentType) {
      case "bill":
        result = await parseInboundBill(supabase, input, null);
        break;
      case "lease_agreement":
        result = await parseLeaseAgreement(supabase, input, null);
        break;
      case "rent_statement":
        result = await parseRentStatement(supabase, input, null);
        break;
      case "property_document":
        result = await parsePropertyDocument(supabase, input, null);
        break;
      case "depreciation_report":
        result = await parseDepreciationReport(supabase, input, null);
        break;
      case "loan_document":
        result = await parseLoanDocument(supabase, input, null);
        break;
      case "loan_statement":
        result = await parseLoanStatement(supabase, input, null);
        break;
      case "bank_statement":
        result = await parseBankStatement(supabase, input, null);
        break;
      case "property_sale":
        result = await parsePropertySale(supabase, input, null);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unsupported document type: ${body.documentType}` }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (e) {
    console.error("[reparse-document] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Extraction failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error || "Couldn't extract this document as that type" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("ai_intake_proposals").delete().eq("id", body.proposalId);

  const r = result as { proposalId?: string; billId?: string };
  return new Response(JSON.stringify({ ok: true, proposalId: r.proposalId, billId: r.billId, documentType: body.documentType }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
