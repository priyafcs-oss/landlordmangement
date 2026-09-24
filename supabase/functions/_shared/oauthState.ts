/**
 * Signs/verifies the OAuth `state` param carrying the connecting owner's id through Google's
 * redirect round trip. oauth-google-drive-callback is invoked by Google's own browser redirect —
 * it carries no Supabase session, so `state` (not a bearer token) is the only way it learns which
 * owner just authorized. HMAC-signed + short-lived so it can't be forged or replayed stale.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

interface StatePayload {
  ownerId: string;
  nonce: string;
  exp: number;
}

export async function signOAuthState(ownerId: string): Promise<string | null> {
  const secret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET");
  if (!secret) {
    console.error("[oauthState] GOOGLE_OAUTH_STATE_SECRET is not configured");
    return null;
  }
  const payload: StatePayload = { ownerId, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), payloadBytes));
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(signature)}`;
}

export async function verifyOAuthState(state: string): Promise<{ ownerId: string } | null> {
  const secret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET");
  if (!secret) {
    console.error("[oauthState] GOOGLE_OAUTH_STATE_SECRET is not configured");
    return null;
  }
  const [payloadPart, signaturePart] = state.split(".");
  if (!payloadPart || !signaturePart) return null;
  const payloadBytes = base64UrlDecode(payloadPart);
  const signature = base64UrlDecode(signaturePart);
  // Cast needed purely to satisfy TS: lib.dom's BufferSource type wants an ArrayBuffer-backed
  // view specifically, while Uint8Array is typed generically (ArrayBufferLike, which also
  // admits SharedArrayBuffer) — a plain Uint8Array from TextEncoder/base64 decoding is always
  // ArrayBuffer-backed at runtime, so this is safe.
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signature as BufferSource, payloadBytes as BufferSource);
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as StatePayload;
    if (typeof payload.ownerId !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return { ownerId: payload.ownerId };
  } catch {
    return null;
  }
}
