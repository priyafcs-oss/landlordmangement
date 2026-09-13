-- Converts the app from single-tenant (any authenticated user sees everything, per
-- 20260912100000_reenable_auth_requirement.sql) to multi-tenant: each Supabase Auth user gets
-- their own completely separate portfolio. A new signup should see nothing of an existing
-- landlord's data, and vice versa.
--
-- Every table gets an `owner_id` column and its shared "authenticated_full_access" policy is
-- replaced with one scoped to `owner_id = auth.uid()`. Existing rows are backfilled to the one
-- landlord account that has used this app until now (this migration only makes sense for a
-- deployment that already has exactly one real user).
--
-- owner_id's default is `COALESCE(auth.uid(), <first-created auth user>)` rather than plain
-- `auth.uid()` so that service-role calls with no user session (the export-backup and
-- parse-inbound-bill edge functions — see their own comments) still write rows that land somewhere
-- sane instead of failing a NOT NULL check outright. This is a deliberate single-landlord fallback
-- for paths that have no signed-in caller to attribute a row to; it will need a real per-landlord
-- routing story (e.g. one inbound email alias per landlord) once more than one landlord actually
-- relies on those paths.

-- Postgres won't allow a raw subquery inside a column DEFAULT expression, so the "first-created
-- user" fallback used by several DEFAULTs below is wrapped in this STABLE function instead.
CREATE OR REPLACE FUNCTION public.first_landlord_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'properties','tenants','ledger_entries','tenant_invoices','loans','expenses','inspections',
    'rent_changes','lease_history','maintenance_requests','property_bills','app_settings',
    'ai_intake_proposals','providers','entities','assets','gold_details','etf_details',
    'depreciation_items','valuation_snapshots','loan_balance_snapshots','buffers',
    'email_inbox_log','provider_documents','provider_agreements','provider_properties',
    'loan_statements','bank_accounts','insurance_policies','maintenance_items',
    'compliance_certificates','property_notes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id)', t);
    EXECUTE format(
      'UPDATE public.%I SET owner_id = public.first_landlord_id() WHERE owner_id IS NULL',
      t
    );
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN owner_id SET NOT NULL', t);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN owner_id SET DEFAULT COALESCE(auth.uid(), public.first_landlord_id())',
      t
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (owner_id)', t || '_owner_id_idx', t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "owner_full_access" ON public.%I FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())',
      t
    );
  END LOOP;
END $$;

-- app_settings previously kept one global row keyed by the literal id "singleton". Retire that:
-- the existing row becomes the current landlord's own row, keyed by their user id, matching every
-- new signup's row created by the trigger below.
UPDATE public.app_settings SET id = owner_id::text WHERE id = 'singleton';

-- The public tenant maintenance-request form (src/routes/maintenance.tsx) submits with no login,
-- so it can't rely on auth.uid() to attribute a request to the right landlord. Resolve owner_id
-- from the property the request names instead; only fall back to the COALESCE default's
-- "first-created user" behavior when the property itself can't be resolved (e.g. a typed address
-- that didn't match anything).
ALTER TABLE public.maintenance_requests ALTER COLUMN owner_id SET DEFAULT auth.uid();

CREATE OR REPLACE FUNCTION public.set_maintenance_request_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL AND NEW."propertyId" IS NOT NULL THEN
    NEW.owner_id := (SELECT p.owner_id FROM public.properties p WHERE p.id = NEW."propertyId");
  END IF;
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := public.first_landlord_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maintenance_request_owner_trigger ON public.maintenance_requests;
CREATE TRIGGER maintenance_request_owner_trigger
  BEFORE INSERT ON public.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_maintenance_request_owner();

-- Gives a brand-new signup a working Settings page immediately instead of an empty-row edge case.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_settings (id, owner_id)
  VALUES (NEW.id::text, NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
