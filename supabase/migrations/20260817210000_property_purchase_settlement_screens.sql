ALTER TABLE public.properties
  ADD COLUMN "strataLevyAmount" numeric,
  ADD COLUMN "strataLevyFrequency" text,
  ADD COLUMN "insurerName" text,
  ADD COLUMN "insurancePolicyNumber" text,
  ADD COLUMN "insurancePremium" numeric,
  ADD COLUMN "insuranceRenewalDate" date,
  ADD COLUMN "insuranceSumInsured" numeric,
  ADD COLUMN "smokeAlarmCheckDueDate" date,
  ADD COLUMN "poolSafetyCertExpiry" date;

CREATE TABLE public.depreciation_items (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "assetId" text NOT NULL,
  description text NOT NULL,
  "purchaseCost" numeric NOT NULL DEFAULT 0,
  "effectiveLifeYears" numeric NOT NULL DEFAULT 1,
  "purchaseDate" date
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.depreciation_items TO authenticated;
GRANT ALL ON public.depreciation_items TO service_role;
ALTER TABLE public.depreciation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.depreciation_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
