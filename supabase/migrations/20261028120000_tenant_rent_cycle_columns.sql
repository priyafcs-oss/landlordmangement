ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS "rentCycleStartDay" text NOT NULL DEFAULT 'Mon'
    CHECK ("rentCycleStartDay" IN ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  ADD COLUMN IF NOT EXISTS "rentCycleStartDayEffectiveFrom" date;
