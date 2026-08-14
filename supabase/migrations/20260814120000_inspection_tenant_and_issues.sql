ALTER TABLE public.inspections
  ADD COLUMN "tenantId" text,
  ADD COLUMN issues jsonb;
