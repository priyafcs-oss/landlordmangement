import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callGeminiJSON } from "../parse-inbound-bill/gemini.ts";
import { COPILOT_RESPONSE_SCHEMA, buildChatParts } from "../_shared/planSchema.ts";
import type { RawPlanStep } from "../_shared/planSchema.ts";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CopilotResponse {
  answer?: string | null;
  steps?: RawPlanStep[] | null;
}

/**
 * Backs the AI Assistant chat (src/routes/copilot.tsx) — reuses the same GEMINI_API_KEY secret
 * already configured for document extraction, so no new credential was needed. Requires the
 * caller's own session (verified below), same as upload-document/reparse-document.
 *
 * Previously free-text in/out via a bespoke local Gemini caller with no timeout/retry ceiling.
 * Now routes through callGeminiJSON (../parse-inbound-bill/gemini.ts) — the same schema-
 * constrained caller the document-extraction pipeline uses, which gets this function the same
 * 45s timeout + same-model retry + cross-model fallback for free, and lets the landlord ask the
 * assistant to DO something (create a property, add a tenant, ...) and get back a reviewable plan
 * instead of only ever a text answer. The assistant never writes to the database itself — see
 * src/components/AiPlanStepList.tsx for where each proposed step actually gets executed (only on
 * an explicit human click, through the exact same Add dialogs/mutation functions a manual entry
 * would use).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[copilot-chat] GEMINI_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.messages?.length) {
    return new Response(JSON.stringify({ error: "messages is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const systemPrompt = body.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = body.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const parts = buildChatParts(systemPrompt, turns);

  try {
    const result = await callGeminiJSON<CopilotResponse>(apiKey, parts, COPILOT_RESPONSE_SCHEMA);
    return new Response(JSON.stringify({ answer: result.answer ?? null, steps: result.steps ?? null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const status = (e as { status?: number }).status === 429 ? 429 : 500;
    console.error("[copilot-chat] Gemini call failed", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "AI request failed" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
