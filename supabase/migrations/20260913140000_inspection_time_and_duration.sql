-- Lets a booked inspection carry a specific time of day and an estimated duration, not just a
-- date — needed so multiple properties booked in one action can each get their own time (and
-- day), instead of every property in the batch landing on the same one shared date.
ALTER TABLE public.inspections ADD COLUMN "time" text;
ALTER TABLE public.inspections ADD COLUMN "durationMinutes" integer;
