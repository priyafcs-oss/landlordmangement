import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getAccessTokenForOwner, listDriveFiles } from "../_shared/googleDrive.ts";

/**
 * Server-side counterpart to src/lib/usage.ts's getStorageUsageSummary, for a landlord whose files
 * now live in their own Drive rather than the shared Supabase bucket — sums every file under their
 * "Landlord OS Documents" root folder. Same {bytes, fileCount} shape the Settings usage card
 * already expects, so that component doesn't need to know which backend it's reading from.
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

  const token = await getAccessTokenForOwner(supabase, userData.user.id, "self");
  if (!token) {
    return new Response(JSON.stringify({ error: "Google Drive is not connected" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const files = await listDriveFiles(token.accessToken, token.rootFolderId);
  const bytes = files.reduce((sum, f) => sum + f.size, 0);

  return new Response(JSON.stringify({ bytes, fileCount: files.length }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
