/**
 * Every function called directly from the browser via supabase.functions.invoke() needs this —
 * without it, the browser's CORS preflight (OPTIONS) gets no Access-Control-Allow-* headers back
 * and the actual request never goes out, surfacing to the caller as "Failed to send a request to
 * the Edge Function" even though the function itself is fine. Functions only ever called from a
 * server-side webhook (e.g. parse-inbound-bill's own entrypoint) don't need this.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
