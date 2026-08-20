import { corsHeaders } from "../_shared/cors.ts";

const AUTH_URL = "https://auth.domain.com.au/v1/connect/token";
const API_BASE = "https://api.domain.com.au/v1";

interface SuggestRequest {
  mode: "suggest";
  query: string;
}
interface DetailsRequest {
  mode: "details";
  propertyId: string;
}
type LookupRequest = SuggestRequest | DetailsRequest;

interface DomainSuggestion {
  id: string;
  address: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Domain's OAuth2 client_credentials token — cached in module scope for the life of this warm
 * function instance (cold starts just fetch a new one), so a burst of suggest calls while the
 * landlord is typing doesn't re-auth on every keystroke.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.value;

  const clientId = Deno.env.get("DOMAIN_CLIENT_ID");
  const clientSecret = Deno.env.get("DOMAIN_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("DOMAIN_CLIENT_ID/DOMAIN_CLIENT_SECRET not configured");

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      // Confirmed against a live call: api_addresslocators_read isn't the scope the _suggest/
      // property-details endpoints actually check — they want api_properties_read.
      scope: "api_properties_read",
    }),
  });
  if (!res.ok) throw new Error(`Domain auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const token = data.access_token as string;
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  cachedToken = { value: token, expiresAt: Date.now() + expiresInMs };
  return token;
}

/** Domain's suggest response shape isn't verified against a live call yet — this reads a few
 * plausible field-name variants defensively so it degrades gracefully rather than throwing if the
 * real shape differs slightly; adjust here once tested against a real API key. */
function normalizeSuggestion(item: Record<string, unknown>): DomainSuggestion | null {
  const id = String(item.id ?? item.propertyId ?? "");
  const addr = item.address;
  const address =
    typeof addr === "string"
      ? addr
      : ((addr as Record<string, unknown> | undefined)?.displayAddress as string | undefined) ??
        (item.displayAddress as string | undefined) ??
        "";
  if (!id || !address) return null;
  return { id, address };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: LookupRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const token = await getAccessToken();

    if (body.mode === "suggest") {
      if (!body.query || body.query.trim().length < 3) {
        return new Response(JSON.stringify({ ok: true, suggestions: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const url = `${API_BASE}/properties/_suggest?terms=${encodeURIComponent(body.query)}&pageSize=6&channel=All`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Domain suggest failed: ${res.status} ${await res.text()}`);
      const raw = (await res.json()) as Record<string, unknown>[];
      const suggestions = raw.map(normalizeSuggestion).filter((s): s is DomainSuggestion => !!s);
      return new Response(JSON.stringify({ ok: true, suggestions }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.mode === "details") {
      const res = await fetch(`${API_BASE}/properties/${encodeURIComponent(body.propertyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Domain details failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          ok: true,
          bedrooms: data.bedrooms ?? data.beds ?? null,
          bathrooms: data.bathrooms ?? data.baths ?? null,
          carSpaces: data.carspaces ?? data.carSpaces ?? data.parking ?? null,
          landSizeSqm: data.landAreaSqm ?? data.landArea ?? null,
          domainPropertyType: data.propertyType ?? data.propertyCategory ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown mode" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[domain-lookup] unhandled error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Domain lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
