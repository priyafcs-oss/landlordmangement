-- Annual running-cost budget figures, a PM fee percentage, a free-text notes
-- field, and a photo/video gallery for properties (photos/videos follow the
-- same {name, data}[] base64-array shape already used by inspections.photos).
ALTER TABLE public.properties
  ADD COLUMN "councilRatesAnnual" numeric,
  ADD COLUMN "waterRatesAnnual" numeric,
  ADD COLUMN "insuranceAnnual" numeric,
  ADD COLUMN "strataFeesAnnual" numeric,
  ADD COLUMN "landTaxAnnual" numeric,
  ADD COLUMN "repairsMaintenanceAnnual" numeric,
  ADD COLUMN "pmFeePercent" numeric,
  ADD COLUMN notes text,
  ADD COLUMN photos jsonb,
  ADD COLUMN videos jsonb;
