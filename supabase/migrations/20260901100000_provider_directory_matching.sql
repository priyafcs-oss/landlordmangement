-- Turns the per-property Providers contact list into a real portfolio-wide vendor directory:
-- the first real FK into "providers" anywhere in this schema (every other cross-table reference
-- in this app is a free-text id column, not an actual constraint), so the AI bill/bank-statement
-- pipeline can resolve a vendor to a known Provider and a provider's profile page can roll up its
-- cross-property payment history. IDs throughout this schema are app-generated `text`, not `uuid`
-- (see providers.id/expenses.id/property_bills.id) — providerId columns match that convention
-- rather than introducing a uuid type. ON DELETE SET NULL on expenses/property_bills/
-- maintenance_items so deleting a provider (deleteProvider in store.tsx) can never fail on an FK
-- violation from a linked transaction.

ALTER TABLE public.expenses
  ADD COLUMN "providerId" text REFERENCES public.providers(id) ON DELETE SET NULL;

ALTER TABLE public.property_bills
  ADD COLUMN "providerId" text REFERENCES public.providers(id) ON DELETE SET NULL;

ALTER TABLE public.maintenance_items
  ADD COLUMN "providerId" text REFERENCES public.providers(id) ON DELETE SET NULL;

ALTER TABLE public.providers
  ADD COLUMN "defaultCategory" text;

CREATE INDEX IF NOT EXISTS providers_name_lower_idx ON public.providers (lower(name));
CREATE INDEX IF NOT EXISTS providers_abn_idx ON public.providers (abn);

-- Documents held against the provider itself (certs of currency, trade licences) rather than a
-- property — mirrors insurance_policies/compliance_certificates so the provider profile page can
-- badge them with the same daysUntil()-driven expiry treatment.
CREATE TABLE public.provider_documents (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "providerId" text NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  "docType" text,
  "fileName" text,
  "fileData" text,
  "expiryDate" date
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_documents TO anon, authenticated;
GRANT ALL ON public.provider_documents TO service_role;
ALTER TABLE public.provider_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single_landlord_app_access" ON public.provider_documents FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
