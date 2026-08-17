CREATE TABLE public.assets (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  "assetType" text NOT NULL,
  name text NOT NULL,
  "ownerEntityId" text,
  "purchaseDate" date,
  "purchaseCost" numeric,
  "currentValue" numeric NOT NULL DEFAULT 0,
  "valuationDate" date,
  status text NOT NULL DEFAULT 'Active',
  tags text[],
  notes text,
  "linkedPropertyId" text
);

CREATE TABLE public.gold_details (
  "assetId" text PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  form text,
  "gramsHeld" numeric,
  "storageLocation" text
);

CREATE TABLE public.etf_details (
  "assetId" text PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  ticker text,
  exchange text,
  "unitsHeld" numeric,
  "avgCostPerUnit" numeric
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.assets FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_details TO authenticated;
GRANT ALL ON public.gold_details TO service_role;
ALTER TABLE public.gold_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.gold_details FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.etf_details TO authenticated;
GRANT ALL ON public.etf_details TO service_role;
ALTER TABLE public.etf_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.etf_details FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.properties ADD COLUMN "assetId" text;
ALTER TABLE public.expenses ADD COLUMN "assetId" text;
ALTER TABLE public.property_bills ADD COLUMN "assetId" text;
ALTER TABLE public.loans ADD COLUMN "assetId" text, ADD COLUMN "offsetBalance" numeric;
