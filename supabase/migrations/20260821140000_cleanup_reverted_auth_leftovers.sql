-- Cleans up two objects left over from the "Phase 1 auth" experiment
-- (20260814180000_require_auth.sql), which locked every table to `authenticated` only and carved
-- out two narrow anon exceptions for the public maintenance-request form. That auth requirement
-- was reverted four days later (20260818100000_drop_auth_requirement.sql, "login was adding
-- friction without real security need at this stage") — every table went back to
-- `single_landlord_app_access` (anon+authenticated, USING(true)) — but the two narrow anon
-- carve-outs built specifically to work around the (now-gone) auth requirement were never
-- cleaned up, and Supabase's own advisor flags both:
--
-- 1. properties_public is a SECURITY DEFINER view (Postgres default) — it was built that way
--    deliberately, back when anon had no direct access to `properties` and the view needed the
--    owner's privileges to read it at all. Now that `properties` is back to USING(true) for
--    anon, running as the owner instead of the querying role serves no purpose and is a landmine:
--    if RLS on `properties` is ever tightened again in the future, this view would silently keep
--    exposing address/alias/tenantCode regardless, undermining that tightening. Postgres 15+
--    supports switching a view to run with the invoker's privileges instead.
--
-- 2. anon_submit_maintenance_request duplicates what single_landlord_app_access (FOR ALL,
--    USING(true)) already covers for anon INSERT on maintenance_requests — flagged by the
--    advisor as "multiple permissive policies" (each policy is evaluated per query, so this is
--    pure overhead with zero behavioral difference).
ALTER VIEW public.properties_public SET (security_invoker = true);

DROP POLICY IF EXISTS "anon_submit_maintenance_request" ON public.maintenance_requests;
