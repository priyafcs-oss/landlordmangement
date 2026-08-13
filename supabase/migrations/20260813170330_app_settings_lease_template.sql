-- Stores the landlord-uploaded fillable lease agreement template (base64),
-- the last field-inspection result, and the saved field-name mapping —
-- landlord-wide, one template serves every property/tenant.
ALTER TABLE public.app_settings
  ADD COLUMN "leaseTemplate" jsonb;
