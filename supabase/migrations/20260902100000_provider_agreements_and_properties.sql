-- Splits provider identity (name/contact/ABN — portfolio-wide) from per-property management-
-- agreement terms, which today live conflated on one providers row scoped to a single propertyId
-- (added in 20260827110000_provider_management_agreement.sql and
-- 20260830120000_provider_agreement_advertising_notice.sql). That conflation is why adding the
-- same real-world agency from two properties' Providers tabs creates two separate provider rows
-- (each only dedups within its own property, see findOrCreateProvider in store.tsx), and why one
-- agency's agreement terms couldn't vary between the different properties it manages.
--
-- provider_agreements: one row per (provider, property) management-agreement — the fee/contract
-- fields, copied 1:1 off providers' existing columns, plus a new "gstApplicable" flag (no fee had
-- any GST concept before this). No uniqueness constraint on the pair: a renewed agreement at the
-- same property is a new row — callers pick the most recent by "contractStartDate".
--
-- provider_properties: a lightweight tag recording "this provider is associated with this
-- property", for contacts that don't necessarily have formal agreement terms (a plumber, an
-- insurer, a council). Unique on the pair so re-adding an existing portfolio provider to a
-- property is a no-op, not a duplicate.
--
-- IDs are app-generated text everywhere in this schema (uid() in store.tsx) — the one-off backfill
-- inserts below follow the same id-generation pattern already used by
-- 20260817190001_assets_backfill.sql for a server-side SQL insert.

CREATE TABLE public.provider_agreements (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "providerId" text NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  "propertyId" text NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  "contractFileName" text,
  "contractFileData" text,
  "managementFeePercent" numeric,
  "lettingFeeAmount" numeric,
  "lettingFeeWeeksRent" numeric,
  "adminFeeAmount" numeric,
  "adminFeeFrequency" text,
  "leaseRenewalFeeAmount" numeric,
  "inspectionFeeAmount" numeric,
  "advertisingFeeAmount" numeric,
  "noticePeriodDays" numeric,
  "contractStartDate" text,
  "contractReviewDate" text,
  "contractNotes" text,
  "gstApplicable" boolean NOT NULL DEFAULT false
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_agreements TO anon, authenticated;
GRANT ALL ON public.provider_agreements TO service_role;
ALTER TABLE public.provider_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single_landlord_app_access" ON public.provider_agreements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS provider_agreements_provider_idx ON public.provider_agreements ("providerId");
CREATE INDEX IF NOT EXISTS provider_agreements_property_idx ON public.provider_agreements ("propertyId");

CREATE TABLE public.provider_properties (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "providerId" text NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  "propertyId" text NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  UNIQUE ("providerId", "propertyId")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_properties TO anon, authenticated;
GRANT ALL ON public.provider_properties TO service_role;
ALTER TABLE public.provider_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single_landlord_app_access" ON public.provider_properties FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS provider_properties_provider_idx ON public.provider_properties ("providerId");
CREATE INDEX IF NOT EXISTS provider_properties_property_idx ON public.provider_properties ("propertyId");

-- Additive data migration only — no merging/deduping of provider identities here (a blind SQL
-- merge by name/ABN risks silently combining two different real-world businesses that happen to
-- share a name, or misassigning which agreement belonged to which property). See the "Merge
-- providers" tool on /providers, shipped alongside this migration, for that. The legacy columns on
-- providers are left in place, untouched — new application code stops reading/writing them.

INSERT INTO public.provider_properties (id, "providerId", "propertyId")
SELECT 'provprop_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), p.id, p."propertyId"
FROM public.providers p
WHERE p."propertyId" IS NOT NULL
ON CONFLICT ("providerId", "propertyId") DO NOTHING;

INSERT INTO public.provider_agreements (
  id, "providerId", "propertyId", "contractFileName", "contractFileData", "managementFeePercent",
  "lettingFeeAmount", "lettingFeeWeeksRent", "adminFeeAmount", "adminFeeFrequency",
  "leaseRenewalFeeAmount", "inspectionFeeAmount", "advertisingFeeAmount", "noticePeriodDays",
  "contractStartDate", "contractReviewDate", "contractNotes"
)
SELECT
  'provagr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), p.id, p."propertyId",
  p."contractFileName", p."contractFileData", p."managementFeePercent", p."lettingFeeAmount",
  p."lettingFeeWeeksRent", p."adminFeeAmount", p."adminFeeFrequency", p."leaseRenewalFeeAmount",
  p."inspectionFeeAmount", p."advertisingFeeAmount", p."noticePeriodDays", p."contractStartDate",
  p."contractReviewDate", p."contractNotes"
FROM public.providers p
WHERE p."propertyId" IS NOT NULL
  AND (
    p."contractFileName" IS NOT NULL OR p."contractFileData" IS NOT NULL OR
    p."managementFeePercent" IS NOT NULL OR p."lettingFeeAmount" IS NOT NULL OR
    p."lettingFeeWeeksRent" IS NOT NULL OR p."adminFeeAmount" IS NOT NULL OR
    p."adminFeeFrequency" IS NOT NULL OR p."leaseRenewalFeeAmount" IS NOT NULL OR
    p."inspectionFeeAmount" IS NOT NULL OR p."advertisingFeeAmount" IS NOT NULL OR
    p."noticePeriodDays" IS NOT NULL OR p."contractStartDate" IS NOT NULL OR
    p."contractReviewDate" IS NOT NULL OR p."contractNotes" IS NOT NULL
  );
