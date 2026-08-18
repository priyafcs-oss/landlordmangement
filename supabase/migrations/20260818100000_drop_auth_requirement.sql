-- Reverting Phase 1 auth per explicit request (2026-08-18) — free tier, single landlord, heavy
-- active development right now, login was adding friction without real security need at this
-- stage. Restores anon+authenticated access on every table the app uses, matching how it worked
-- before auth existed. Covers both the original 13 tables locked down by the auth migration and
-- every table added since (which only ever had "authenticated_full_access").

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'properties','tenants','ledger_entries','tenant_invoices','loans','expenses','inspections',
    'rent_changes','lease_history','maintenance_requests','property_bills','app_settings',
    'ai_intake_proposals','providers','entities','assets','gold_details','etf_details',
    'depreciation_items','valuation_snapshots','loan_balance_snapshots','buffers'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access" ON public.%I', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon', t);
    EXECUTE format(
      'CREATE POLICY "single_landlord_app_access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;
