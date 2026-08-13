ALTER TABLE public.tenants
  ADD COLUMN "additionalTenants" jsonb,
  ADD COLUMN "bondPaidTo" text CHECK ("bondPaidTo" IN ('Landlord', 'Agent', 'NSW Fair Trading')),
  ADD COLUMN "landlordConsentsToElectronicService" boolean,
  ADD COLUMN "tenantConsentsToElectronicService" boolean;

ALTER TABLE public.app_settings
  ADD COLUMN "tenantInfoStatement" jsonb;
