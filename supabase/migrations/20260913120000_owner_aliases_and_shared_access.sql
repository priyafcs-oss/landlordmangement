-- Discovered right after the multi-tenant conversion (20260913100000): this deployment already had
-- TWO auth accounts (priya.fcs@gmail.com, mjain29@gmail.com) sharing the one portfolio that
-- existed under the old single-tenant model, not one. The owner_id backfill in that migration
-- necessarily picked a single "first-created" owner (priya.fcs@gmail.com) for every existing row —
-- this migration restores mjain29@gmail.com's access to that same data via an alias, rather than
-- leaving it as a second, empty tenant.
--
-- public.owner_aliases lets one auth user be treated as another for every owner_id check —
-- effective_owner_id() resolves through it, falling back to the caller's own auth.uid() when no
-- alias row exists (i.e. every normal, non-aliased account). Every table's DEFAULT and RLS policy
-- from the previous migration is repointed from auth.uid() to effective_owner_id() so an aliased
-- user reads and writes exactly as if they were the canonical owner.

CREATE TABLE public.owner_aliases (
  alias_user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  canonical_owner_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.owner_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_aliases FROM anon, authenticated;
-- No policies: only effective_owner_id() (SECURITY DEFINER, below) can read this table. Rows are
-- added by hand via a migration/SQL, same as a Supabase Auth user is created by hand today.

CREATE OR REPLACE FUNCTION public.effective_owner_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT canonical_owner_id FROM public.owner_aliases WHERE alias_user_id = auth.uid()),
    auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.effective_owner_id() TO authenticated;

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
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN owner_id SET DEFAULT COALESCE(public.effective_owner_id(), public.first_landlord_id())',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS "owner_full_access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "owner_full_access" ON public.%I FOR ALL TO authenticated USING (owner_id = public.effective_owner_id()) WITH CHECK (owner_id = public.effective_owner_id())',
      t
    );
  END LOOP;
END $$;

-- maintenance_requests keeps its own narrower default (no first_landlord_id() fallback — see
-- 20260913100000) so the BEFORE INSERT trigger can still tell an unresolved anon submission
-- (owner_id IS NULL) apart from a resolved one.
ALTER TABLE public.maintenance_requests ALTER COLUMN owner_id SET DEFAULT public.effective_owner_id();

-- app_settings moves from being keyed by `id` (previously the literal "singleton", now one
-- landlord's own user id) to being keyed by `owner_id` — needed so an aliased user's upsert
-- updates the canonical owner's existing row instead of creating a second one under their own id.
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_owner_id_key UNIQUE (owner_id);

INSERT INTO public.owner_aliases (alias_user_id, canonical_owner_id)
SELECT alias.id, canonical.id
FROM auth.users alias, auth.users canonical
WHERE alias.email = 'mjain29@gmail.com' AND canonical.email = 'priya.fcs@gmail.com'
ON CONFLICT (alias_user_id) DO NOTHING;
