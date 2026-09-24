import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { signOAuthState } from "../_shared/oauthState.ts";

/**
 * Called from Settings' "Connect Google Drive" button — builds Google's OAuth consent URL for the
 * signed-in landlord and hands it back so the browser can do a full-page redirect to it. Scoped to
 * `drive.file` only: the app will only ever be able to see/manage files it itself creates in this
 * landlord's Drive, never their existing files. See oauth-google-drive-callback for the other half
 * of this flow.
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

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI");
  if (!clientId || !redirectUri) {
    console.error("[oauth-google-drive-start] GOOGLE_OAUTH_CLIENT_ID/REDIRECT_URI not configured");
    return new Response(JSON.stringify({ error: "Google Drive connection is not configured yet" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const state = await signOAuthState(userData.user.id);
  if (!state) {
    return new Response(JSON.stringify({ error: "Google Drive connection is not configured yet" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return new Response(JSON.stringify({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
