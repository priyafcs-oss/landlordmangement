ALTER TABLE public.tenants
  ALTER COLUMN "rentCycleStartDay" DROP NOT NULL,
  ALTER COLUMN "rentCycleStartDay" SET DEFAULT NULL;

UPDATE public.tenants
SET "rentCycleStartDay" = NULL
WHERE "rentCycleStartDay" = 'Mon'
  AND "rentCycleStartDayEffectiveFrom" IS NULL
  AND "leaseStart" IS NOT NULL
  AND to_char("leaseStart"::date, 'Dy') <> 'Mon';
