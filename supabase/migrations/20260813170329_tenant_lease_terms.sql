-- Tenancy-specific lease terms (unlike the premises disclosures on
-- properties, these can genuinely differ per tenancy at the same property).
ALTER TABLE public.tenants
  ADD COLUMN "petsAllowed" boolean,
  ADD COLUMN "petsDescription" text,
  ADD COLUMN "additionalLeaseTerms" text;
