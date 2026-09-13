-- Lets the project owner see across tenants for oversight — who's signed up, when, and roughly
-- how much data each account has — without weakening the owner-scoped RLS every other table
-- relies on. Nothing here grants write access to another tenant's data, and it's read-only
-- visibility, not control: no suspend/approve/billing here, deliberately kept out of scope until
-- actually needed (see CLAUDE.md).
--
-- public.platform_admins has no policies at all (like login_attempts/owner_aliases) — reachable
-- only through the SECURITY DEFINER functions below, which check membership before returning
-- anything.

CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- Sums row counts across every tenant-data table, grouped by owner_id — a rough "how much data
-- do they have" signal without enumerating every table's columns. Not granted to anyone directly;
-- only callable from admin_list_tenants() below (which runs as this function's owner too, so no
-- grant is needed for that internal call).
CREATE OR REPLACE FUNCTION public.admin_tenant_row_counts()
RETURNS TABLE(owner_id uuid, total_rows bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t text;
  parts text[] := ARRAY[]::text[];
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'properties','tenants','ledger_entries','tenant_invoices','loans','expenses','inspections',
    'rent_changes','lease_history','maintenance_requests','property_bills',
    'ai_intake_proposals','providers','entities','assets','gold_details','etf_details',
    'depreciation_items','valuation_snapshots','loan_balance_snapshots','buffers',
    'email_inbox_log','provider_documents','provider_agreements','provider_properties',
    'loan_statements','bank_accounts','insurance_policies','maintenance_items',
    'compliance_certificates','property_notes'
  ]
  LOOP
    parts := array_append(parts, format('SELECT owner_id, count(*)::bigint AS c FROM public.%I GROUP BY owner_id', t));
  END LOOP;

  RETURN QUERY EXECUTE format(
    'SELECT x.owner_id, sum(x.c)::bigint FROM (%s) x GROUP BY x.owner_id',
    array_to_string(parts, ' UNION ALL ')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE(
  user_id uuid,
  email text,
  created_at timestamptz,
  is_admin boolean,
  aliased_to_email text,
  properties_count bigint,
  tenants_count bigint,
  total_rows bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    u.created_at,
    (pa.user_id IS NOT NULL),
    alias_target.email::text,
    COALESCE(prop.c, 0)::bigint,
    COALESCE(ten.c, 0)::bigint,
    COALESCE(rc.total_rows, 0)::bigint
  FROM auth.users u
  LEFT JOIN public.platform_admins pa ON pa.user_id = u.id
  LEFT JOIN public.owner_aliases oa ON oa.alias_user_id = u.id
  LEFT JOIN auth.users alias_target ON alias_target.id = oa.canonical_owner_id
  LEFT JOIN public.admin_tenant_row_counts() rc ON rc.owner_id = COALESCE(oa.canonical_owner_id, u.id)
  LEFT JOIN LATERAL (
    SELECT count(*) AS c FROM public.properties p WHERE p.owner_id = COALESCE(oa.canonical_owner_id, u.id)
  ) prop ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS c FROM public.tenants t WHERE t.owner_id = COALESCE(oa.canonical_owner_id, u.id)
  ) ten ON true
  ORDER BY u.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_tenants() TO authenticated;

INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'priya.fcs@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
