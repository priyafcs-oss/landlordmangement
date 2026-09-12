-- Re-enabling login per explicit request (2026-09-12) — reverses
-- 20260818100000_drop_auth_requirement.sql. Locks every table the app currently uses back to
-- `authenticated` only, covering both the original 13 tables from the first auth attempt
-- (20260814180000_require_auth.sql) and every table added since (18 more, all of which have only
-- ever had the permissive `single_landlord_app_access` policy — they never went through an auth
-- window of their own). Existing Supabase Auth accounts are untouched; both remain valid sign-ins.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Original 13 (first went through this exact transition once already).
    'properties','tenants','ledger_entries','tenant_invoices','loans','expenses','inspections',
    'rent_changes','lease_history','maintenance_requests','property_bills','app_settings',
    'ai_intake_proposals',
    -- Added while the first auth window was active, reverted alongside the original 13.
    'providers','entities','assets','gold_details','etf_details','depreciation_items',
    'valuation_snapshots','loan_balance_snapshots','buffers',
    -- Added after auth was dropped — never locked down before now.
    'email_inbox_log','provider_documents','provider_agreements','provider_properties',
    'loan_statements','bank_accounts','insurance_policies','maintenance_items',
    'compliance_certificates','property_notes'
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

-- The public tenant maintenance-request form (src/routes/maintenance.tsx) has no login of its own
-- — restore the same narrow anon carve-out the first auth window used: insert-only, no read/
-- update/delete, not even of a tenant's own submitted request.
GRANT INSERT ON public.maintenance_requests TO anon;
CREATE POLICY "anon_submit_maintenance_request" ON public.maintenance_requests
  FOR INSERT TO anon WITH CHECK (true);

-- properties_public (the same form's minimal address/tenant-code lookup) was switched to run with
-- the QUERYING role's own privileges (20260821140000_cleanup_reverted_auth_leftovers.sql) once
-- `properties` had no RLS worth respecting anyway. Now that `properties` is locked to
-- `authenticated` above, invoker-security would make this view return nothing for anon — switching
-- back to definer-security (the Postgres default, and what this view was built for originally) is
-- what actually lets anon read this narrow, already-safe (non-financial) slice of `properties`
-- despite having no direct access to the base table.
ALTER VIEW public.properties_public SET (security_invoker = false);
