-- Mirror every existing property into the new assets table.
INSERT INTO public.assets (id, "assetType", name, "purchaseDate", "purchaseCost", "currentValue", status, "linkedPropertyId")
SELECT
  'asset_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  'Property',
  COALESCE(NULLIF(alias, ''), address),
  NULLIF("purchaseDate", '')::date,
  "purchasePrice",
  "currentValue",
  'Active',
  id
FROM public.properties
WHERE "assetId" IS NULL;

-- Link each property back to its new mirror asset row.
UPDATE public.properties p
SET "assetId" = a.id
FROM public.assets a
WHERE a."linkedPropertyId" = p.id AND p."assetId" IS NULL;

-- Backfill assetId on expenses/property_bills/loans from their property's new asset link.
UPDATE public.expenses e
SET "assetId" = p."assetId"
FROM public.properties p
WHERE e."propertyId" = p.id AND e."assetId" IS NULL;

UPDATE public.property_bills b
SET "assetId" = p."assetId"
FROM public.properties p
WHERE b."propertyId" = p.id AND b."assetId" IS NULL;

UPDATE public.loans l
SET "assetId" = p."assetId"
FROM public.properties p
WHERE l."propertyId" = p.id AND l."assetId" IS NULL;
