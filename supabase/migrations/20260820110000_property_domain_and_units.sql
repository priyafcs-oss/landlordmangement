-- Domain API-fillable attributes, plus dual-occupancy support (one title, multiple dwellings —
-- purchase price/loan/cost base stay on the one Property record; `units` carries each dwelling's
-- own address/bedroom count for tenant-facing purposes).

ALTER TABLE public.properties
  ADD COLUMN bedrooms numeric,
  ADD COLUMN bathrooms numeric,
  ADD COLUMN "carSpaces" numeric,
  ADD COLUMN "landSizeSqm" numeric,
  ADD COLUMN "domainPropertyType" text,
  ADD COLUMN "dwellingConfiguration" text,
  ADD COLUMN units jsonb;
