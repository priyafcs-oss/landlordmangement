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

/**
 * Calls Gemini's generateContent with a strict JSON response schema, retrying across model
 * candidates on 404 (model retired) and returning the parsed JSON. Shared by every extractor
 * in this function (bills, classification, leases, rent statements) so the model-fallback
 * behavior only needs to be gotten right once.
 */
export async function callGeminiJSON<T>(
  apiKey: string,
  parts: Record<string, unknown>[],
  responseSchema: Record<string, unknown>,
): Promise<T> {
  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
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
      return JSON.parse(text) as T;
    }

    lastError = `${res.status} ${await res.text()}`;
    // Fall through to the next candidate when the model itself was retired (404), or when THIS
    // model's free-tier quota is exhausted (429) — Gemini's free-tier "requests per day" quota is
    // tracked per-model, so a different model has its own independent allowance and is very
    // plausibly still available even when the primary one is capped out for the day. Any other
    // failure (bad key, malformed request) is a real bug, not a model-availability issue.
    if (res.status !== 404 && res.status !== 429) {
      throw new Error(`Gemini request failed: ${lastError}`);
    }
    console.warn(`[parse-inbound-bill] Gemini model "${model}" unavailable (${res.status}), trying next candidate`);
  }

  throw new Error(`Gemini request failed on all model candidates: ${lastError}`);
}

/**
 * Builds the Gemini request parts for a document (subject/from/body text, plus an optional
 * attachment — PDF or image; Gemini reads both natively as inlineData). `attachmentMimeType`
 * defaults to "application/pdf" for backward compatibility with callers that only ever sent PDFs.
 */
export function buildDocumentParts(
  promptInstructions: string,
  input: { subject: string; fromEmail: string; textBody?: string; pdfBase64?: string; attachmentMimeType?: string },
): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [
    {
      text: `${promptInstructions}

Subject: ${input.subject}
From: ${input.fromEmail}
Body:
${input.textBody ?? "(see attached file)"}`,
    },
  ];
  if (input.pdfBase64) {
    parts.push({
      inlineData: { mimeType: input.attachmentMimeType ?? "application/pdf", data: input.pdfBase64 },
    });
  }
  return parts;
}
