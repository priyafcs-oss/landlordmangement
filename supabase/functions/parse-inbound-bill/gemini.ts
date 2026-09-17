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

// A hung Gemini call previously had no ceiling at all — the edge function just ran until Supabase
// killed it, surfacing to the caller as no HTTP response rather than a clear, retriable-looking
// error (see the "Gemini sometimes taking long to process" reliability report). Kept comfortably
// under Supabase's own edge-function wall-clock limit so this timeout fires first and leaves room
// for the rest of the function's own work (Storage upload, DB writes) afterward.
const GEMINI_TIMEOUT_MS = 45_000;
// Retries on the SAME model, for failures that are plausibly transient (a timeout, or a 5xx) —
// distinct from the model-fallback loop below, which switches to a different model entirely and
// only for reasons a retry on the same model could never fix (404 retired, 429 quota exhausted).
const MAX_TRANSIENT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
      // This is factual extraction, not creative generation — the same document should read the
      // same way every time. Left at Gemini's default (~1.0), two calls on the identical file can
      // genuinely disagree (e.g. finding a rates notice's future instalments on one pass and
      // missing them on another) purely from sampling randomness, not any real ambiguity in the
      // source document.
      temperature: 0,
    },
  });

  const candidates = modelCandidates();
  let lastError = "unknown error";

  for (const model of candidates) {
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetchWithTimeout(
          `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: requestBody },
          GEMINI_TIMEOUT_MS,
        );
      } catch (e) {
        // AbortError (our own timeout) or a network-level failure — both plausibly transient.
        lastError = e instanceof Error ? e.message : "network error";
        if (attempt < MAX_TRANSIENT_RETRIES) {
          console.warn(`[parse-inbound-bill] Gemini call to "${model}" failed (${lastError}), retrying (attempt ${attempt + 2})`);
          await sleep(1000 * (attempt + 1));
          continue;
        }
        break; // exhausted retries on this model — fall through to the next candidate, if any
      }

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
      if (res.status >= 500 && attempt < MAX_TRANSIENT_RETRIES) {
        console.warn(`[parse-inbound-bill] Gemini call to "${model}" failed (${res.status}), retrying (attempt ${attempt + 2})`);
        await sleep(1000 * (attempt + 1));
        continue;
      }
      // Fall through to the next candidate when the model itself was retired (404), or when THIS
      // model's free-tier quota is exhausted (429) — Gemini's free-tier "requests per day" quota is
      // tracked per-model, so a different model has its own independent allowance and is very
      // plausibly still available even when the primary one is capped out for the day. Any other
      // failure (bad key, malformed request, or a 5xx that outlasted its retries) is either a real
      // bug or something no other candidate would fix either, so it's raised immediately.
      if (res.status !== 404 && res.status !== 429 && res.status < 500) {
        throw new Error(`Gemini request failed: ${lastError}`);
      }
      break;
    }
    console.warn(`[parse-inbound-bill] Gemini model "${model}" unavailable (${lastError}), trying next candidate`);
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
