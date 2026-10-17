import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { DRIVE_LINK_EXPIRED, getAccessTokenForOwner, isDriveLinkExpired } from "../_shared/googleDrive.ts";
import { organizeDrive } from "../_shared/driveOrganize.ts";
import { moveStorageFilesToDrive } from "../_shared/storageToDrive.ts";

/**
 * Files the caller's Drive documents into `<property>/<type>/` folders — see
 * ../_shared/driveOrganize.ts. Called (debounced) by src/lib/db.ts after any save that touches a
 * Drive file, and from Settings' "Move to Drive & organise" button — which also sends
 * `{ moveStorage: true }` to first move any documents that fell back to app storage (Drive was
 * disconnected or its link had lapsed when they were saved) into Drive. Reads and writes go
 * through the caller's own session client, so RLS scopes them to exactly their portfolio.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

  const token = await getAccessTokenForOwner(supabase, userData.user.id, "self");
  if (!token) {
    return (await isDriveLinkExpired(supabase, userData.user.id, "self"))
      ? json({ error: DRIVE_LINK_EXPIRED }, 409)
      : json({ error: "Google Drive is not connected" }, 422);
  }

  const body = await req.json().catch(() => ({}));
  const moved = body?.moveStorage
    ? await moveStorageFilesToDrive(supabase, userData.user.id, token.accessToken, token.rootFolderId)
    : null;
  const result = await organizeDrive(supabase, null, token.accessToken, token.rootFolderId);
  const ok = result.ok && (!moved || (moved.errors.length === 0 && moved.filesFailed === 0));
  return json({ ...result, ok, movedToDrive: moved?.filesMoved ?? 0, moveFailed: moved?.filesFailed ?? 0 }, ok ? 200 : 500);
});
