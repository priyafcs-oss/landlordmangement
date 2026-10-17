import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

/** A JSON response with CORS headers — every browser-called function's responses go through this. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Answers the CORS preflight and rejects non-POST — null means carry on handling the request. */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  return null;
}

/** Gemini reads PDFs and common image formats natively as inlineData — anything else is rejected. */
export function isSupportedAttachment(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

/**
 * The signed-in caller, or a 401 response. These functions run with `verify_jwt = false` (this
 * project's API key is the opaque sb_publishable_ format, which isn't a JWT and fails gateway
 * verification), so the session token is checked here instead. The returned client is built from
 * the caller's own token, so any DB access through it is owner-scoped by RLS.
 */
export async function requireUser(req: Request): Promise<{ supabase: SupabaseClient; userId: string } | Response> {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ error: "Unauthorized" }, 401);
  return { supabase, userId: data.user.id };
}
