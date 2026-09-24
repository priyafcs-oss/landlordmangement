import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyOAuthState } from "../_shared/oauthState.ts";
import { DRIVE_ROOT_FOLDER_NAME, findOrCreateRootFolder } from "../_shared/googleDrive.ts";

/**
 * Google redirects the landlord's browser here after they approve (or deny) the consent screen
 * from oauth-google-drive-start. This is a plain top-level navigation from Google, not an
 * app-initiated fetch — there is no Bearer token to check, so `state` (HMAC-signed, see
 * ../_shared/oauthState.ts) is what recovers which owner just connected. Exchanges the auth code
 * for tokens, creates/finds that owner's "Landlord OS Documents" root folder, and stores the
 * refresh token via the service-role-only admin_upsert_google_drive_connection RPC
 * (20260924100000_google_drive_connections.sql) — then redirects back into the app.
 */
function siteUrl(): string {
  return Deno.env.get("SITE_URL") || "https://landlordmangement.vercel.app";
}

function redirectToSettings(status: "connected" | "error"): Response {
  return new Response(null, { status: 302, headers: { Location: `${siteUrl()}/settings?drive=${status}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    console.error("[oauth-google-drive-callback] Google returned an error", url.searchParams.get("error"));
    return redirectToSettings("error");
  }
  if (!code || !state) {
    return redirectToSettings("error");
  }

  const verified = await verifyOAuthState(state);
  if (!verified) {
    console.error("[oauth-google-drive-callback] invalid or expired state");
    return redirectToSettings("error");
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[oauth-google-drive-callback] GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI not configured");
    return redirectToSettings("error");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("[oauth-google-drive-callback] code exchange failed", tokenRes.status, await tokenRes.text());
    return redirectToSettings("error");
  }
  const tokenData = await tokenRes.json();
  const refreshToken: string | undefined = tokenData.refresh_token;
  const accessToken: string | undefined = tokenData.access_token;
  if (!refreshToken || !accessToken) {
    // Google only issues a refresh_token on first consent unless prompt=consent forces a new one
    // (set in oauth-google-drive-start) — if this still happens, the landlord needs to revoke
    // the app's access in their Google Account settings and reconnect.
    console.error("[oauth-google-drive-callback] no refresh_token in response — missing prompt=consent or already authorized");
    return redirectToSettings("error");
  }

  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const connectedEmail: string | null = userInfoRes.ok ? (await userInfoRes.json()).email ?? null : null;

  const rootFolderId = await findOrCreateRootFolder(accessToken, DRIVE_ROOT_FOLDER_NAME);
  if (!rootFolderId) {
    console.error("[oauth-google-drive-callback] failed to create root folder");
    return redirectToSettings("error");
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.rpc("admin_upsert_google_drive_connection", {
    p_owner_id: verified.ownerId,
    p_refresh_token: refreshToken,
    p_connected_email: connectedEmail,
    p_root_folder_id: rootFolderId,
  });
  if (error) {
    console.error("[oauth-google-drive-callback] failed to store connection", error);
    return redirectToSettings("error");
  }

  return redirectToSettings("connected");
});
