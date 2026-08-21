import { buildDocumentParts, callGeminiJSON } from "../parse-inbound-bill/gemini.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { isOversizedUpload, MAX_AI_UPLOAD_BASE64_CHARS } from "../_shared/limits.ts";

interface ExtractRequest {
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
}

interface BankTransaction {
  date: string;
  description: string;
  amount: number;
  direction: "credit" | "debit";
}

interface ParsedBankStatement {
  transactions: BankTransaction[];
}

const PROMPT = `You are extracting every transaction line from an Australian bank account statement (PDF or photo).
Extract the fields defined in the response schema as strict JSON.
- transactions is every transaction row on the statement, in the order they appear.
- date must be YYYY-MM-DD.
- description is the row's full description/payee/reference text as printed — this is what gets matched against tenant names later, so keep it complete rather than summarizing.
- amount is always a positive number.
- direction is "credit" for money IN (deposits, transfers received) or "debit" for money OUT (withdrawals, payments, fees). Include BOTH — the caller filters to credits itself.
Do not skip any rows, even ones that don't look like rent.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    transactions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          description: { type: "STRING" },
          amount: { type: "NUMBER" },
          direction: { type: "STRING" },
        },
        required: ["date", "description", "amount", "direction"],
      },
    },
  },
  required: ["transactions"],
};

function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * Stateless extraction-only endpoint for Rental Hub's Bank Feed Import — reads a bank statement
 * PDF/photo via Gemini and returns the transaction list. Unlike parse-inbound-bill/upload-document,
 * this never writes to the database: matching a transaction to a tenant and posting it to the
 * ledger stays exactly the human-confirmed, client-side flow it already is for pasted/CSV
 * statements — this just adds a PDF/photo source into that same matching step.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: ExtractRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.fileBase64 || !body.fileName || !body.mimeType) {
    return new Response(JSON.stringify({ error: "fileBase64, fileName and mimeType are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!isSupportedAttachment(body.mimeType)) {
    return new Response(JSON.stringify({ error: "Only PDF and image files are supported" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (isOversizedUpload(body.fileBase64)) {
    return new Response(
      JSON.stringify({
        error: `This file is too large for the AI reader (limit ~${Math.round((MAX_AI_UPLOAD_BASE64_CHARS * 0.75) / (1024 * 1024))}MB). Try a lower-resolution scan, or split it into smaller files.`,
      }),
      { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[extract-bank-statement] GEMINI_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const parts = buildDocumentParts(PROMPT, {
      subject: `Bank statement upload: ${body.fileName}`,
      fromEmail: "manual-upload",
      pdfBase64: body.fileBase64,
      attachmentMimeType: body.mimeType,
    });
    const parsed = await callGeminiJSON<ParsedBankStatement>(apiKey, parts, SCHEMA);
    return new Response(JSON.stringify({ ok: true, transactions: parsed.transactions ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[extract-bank-statement] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Extraction failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
