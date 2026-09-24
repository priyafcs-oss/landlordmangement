import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { downloadBytesFromDrive, driveFileId, getAccessTokenForOwner, isGoogleDrivePath } from "../_shared/googleDrive.ts";

interface DownloadRequest {
  marker?: string;
}

/**
 * Server-side counterpart to src/lib/files.ts's getSignedDocumentUrl — Google Drive has no
 * browser-safe time-limited signed-URL primitive the way Supabase Storage does, so viewing a
 * "gdrive:<fileId>" marker proxies through here instead: resolves the CALLER's own access token
 * (never a passed-in owner id — this only ever serves the signed-in landlord their own files,
 * and drive.file scope means Google itself would 403 a request for a file this app didn't create
 * even if it somehow got the wrong token), downloads the bytes from Drive, and streams them back
 * (see the response headers below for why the real content type travels separately from the
 * response's own Content-Type) so the browser can build a blob: URL exactly like it did for a
 * Storage-backed file.
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

  let body: DownloadRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.marker || !isGoogleDrivePath(body.marker)) {
    return new Response(JSON.stringify({ error: "A gdrive: marker is required" }), {
      status: 400,
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

  const result = await downloadBytesFromDrive(token.accessToken, driveFileId(body.marker));
  if (!result) {
    return new Response(JSON.stringify({ error: "Couldn't read this file from Google Drive" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // The response body's Content-Type is deliberately always application/octet-stream, NOT Drive's
  // own reported content type — the installed @supabase/supabase-js only auto-parses a
  // functions.invoke() response body as a Blob for Content-Type "application/octet-stream" or
  // "application/pdf" (see node_modules/@supabase/functions-js's FunctionsClient.invoke);
  // anything else — including every image MIME type this app handles — falls through to being
  // read as text, corrupting the bytes. Drive's real content type still goes out as a separate
  // X-File-Content-Type header (exposed via Access-Control-Expose-Headers, since this is a
  // cross-origin response) — the client (src/lib/files.ts) reads that header off invoke()'s own
  // `response` and re-types the Blob correctly for rendering.
  // Cast purely to satisfy TS — same Uint8Array<ArrayBufferLike> vs. ArrayBuffer-only-typed Web
  // API mismatch as ../_shared/oauthState.ts, here against Response's BodyInit type.
  return new Response(result.bytes as BodyInit, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/octet-stream",
      "X-File-Content-Type": result.contentType,
      "Access-Control-Expose-Headers": "X-File-Content-Type",
    },
  });
});
