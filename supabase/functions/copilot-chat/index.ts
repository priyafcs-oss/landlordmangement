import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL_CANDIDATES = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];

function modelCandidates(): string[] {
  const override = Deno.env.get("GEMINI_MODEL");
  const list = override ? [override, ...DEFAULT_MODEL_CANDIDATES] : DEFAULT_MODEL_CANDIDATES;
  return [...new Set(list)];
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Plain-text conversational counterpart to parse-inbound-bill/gemini.ts's `callGeminiJSON` — same
 * model-fallback behavior (retry across candidates on 404/429), but no response schema since this
 * is free-form chat, not structured extraction.
 */
async function callGeminiChat(apiKey: string, messages: ChatMessage[]): Promise<string> {
  const systemMessages = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system");

  const requestBody = JSON.stringify({
    ...(systemMessages ? { systemInstruction: { parts: [{ text: systemMessages }] } } : {}),
    contents: turns.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: 0.7 },
  });

  const candidates = modelCandidates();
  let lastStatus = 500;
  let lastError = "unknown error";

  for (const model of candidates) {
    const res = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini returned no content");
      return text;
    }

    lastStatus = res.status;
    lastError = `${res.status} ${await res.text()}`;
    if (res.status !== 404 && res.status !== 429) {
      throw Object.assign(new Error(`Gemini request failed: ${lastError}`), { status: res.status });
    }
    console.warn(`[copilot-chat] Gemini model "${model}" unavailable (${res.status}), trying next candidate`);
  }

  throw Object.assign(new Error(`Gemini request failed on all model candidates: ${lastError}`), { status: lastStatus });
}

/**
 * Backs the AI Assistant chat (src/routes/copilot.tsx) — reuses the same GEMINI_API_KEY secret
 * already configured for document extraction, so no new credential was needed. Requires the
 * caller's own session (verified below), same as upload-document/reparse-document, though nothing
 * here touches the database — it's here purely so an unauthenticated request can't spend the
 * shared Gemini quota.
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

  try {
    const content = await callGeminiChat(apiKey, body.messages);
    return new Response(JSON.stringify({ content }), {
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
