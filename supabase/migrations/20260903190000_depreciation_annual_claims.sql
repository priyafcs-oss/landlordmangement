-- Persists each depreciation item's full Year 1..N claim schedule as stated/edited in the "Add
-- depreciation report" review, rather than always recomputing it live from cost/life/method —
-- once a schedule has been saved (and potentially already used on a prior tax return), it must
-- stay fixed even if the app's own projection formula changes later. Null means "not yet
-- materialized" (legacy rows saved before this column existed), in which case the app falls back
-- to the live formula.
--
-- reportAnnualSummary is the report's own Year 1..N Div 40/Div 43 total, reviewed/edited once in
-- that same dialog and denormalized identically across every item sharing one reportId (same
-- pattern as quantitySurveyor/reportDate/etc.). It's the authoritative schedule for the report:
-- elsewhere in the app, a reportId group that has this is read from here rather than re-summed
-- from each item's own annualClaims, so the property's depreciation totals always match what was
-- reviewed against the report — not a re-derivation that can drift from it.
ALTER TABLE public.depreciation_items
  ADD COLUMN "annualClaims" jsonb,
  ADD COLUMN "reportAnnualSummary" jsonb;
