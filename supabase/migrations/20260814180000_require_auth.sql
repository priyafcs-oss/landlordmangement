-- Phase 1 auth: every table has been readable/writable by anyone with the (public, embeddable)
-- anon key since day one — RLS was `USING (true) TO anon, authenticated` everywhere. This locks
-- every table to `authenticated` only. Two narrow carve-outs remain for the still-public tenant
-- maintenance-request form, which has no login of its own yet: a minimal, non-financial view of
-- properties for address/tenant-code matching (matching what the form's own copy already
-- promises — "we don't show a list of managed properties" — now actually enforced at the data
-- layer, not just hidden in the UI), and insert-only access to submit a new request.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'properties','tenants','ledger_entries','tenant_invoices','loans','expenses','inspections',
    'rent_changes','lease_history','maintenance_requests','property_bills','app_settings',
    'ai_intake_proposals'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "single_landlord_app_access" ON public.%I', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format(
      'CREATE POLICY "authenticated_full_access" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Minimal public property lookup for the maintenance form — exposes only what's needed to match
-- a typed address/tenant-code to a property id, none of the financial columns. Views run with the
-- owning role's privileges by default (not the invoker's), so this can read the base table even
-- though anon no longer has direct access to it.
CREATE VIEW public.properties_public AS
  SELECT id, address, alias, "tenantCode" FROM public.properties;
GRANT SELECT ON public.properties_public TO anon;

-- Anonymous tenants can still submit a maintenance request without an account; they cannot read,
-- update, or delete any request — including their own.
GRANT INSERT ON public.maintenance_requests TO anon;
CREATE POLICY "anon_submit_maintenance_request" ON public.maintenance_requests
  FOR INSERT TO anon WITH CHECK (true);
