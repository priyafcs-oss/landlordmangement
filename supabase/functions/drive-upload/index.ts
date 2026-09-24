import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getAccessTokenForOwner, uploadBytesToDrive } from "../_shared/googleDrive.ts";

interface UploadRequest {
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const raw = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Server-side counterpart to src/lib/files.ts's uploadDocumentFile/uploadDocumentBase64 — the
 * browser never holds a Drive refresh token, so every client-side upload now round-trips through
 * here instead of calling Supabase Storage directly. Uploads into the caller's OWN connected
 * Drive (resolved via their own session, never a passed-in owner id) and returns a
 * "gdrive:<fileId>" marker for the caller to persist in place of a "storage:<path>" one.
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

  let body: UploadRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.fileBase64 || !body.fileName) {
    return new Response(JSON.stringify({ error: "fileBase64 and fileName are required" }), {
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

  const marker = await uploadBytesToDrive(
    token.accessToken,
    token.rootFolderId,
    base64ToUint8Array(body.fileBase64),
    body.fileName,
    body.mimeType || "application/octet-stream",
  );
  if (!marker) {
    return new Response(JSON.stringify({ error: "Upload to Google Drive failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ marker }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
