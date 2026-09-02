-- The agreement-wide "gstApplicable" switch (added in 20260902100000) is now fully superseded by
-- the per-fee "*GstInclusive" flags (added in 20260902110000): each fee's own flag alone decides
-- whether feeVerification.ts adds 10% to it, so a separate "is this agency GST-registered" toggle
-- was redundant and, worse, confusing on screen next to per-fee toggles that already answer the
-- same question more precisely. No data migration needed — the per-fee flags are the values that
-- now matter, and any existing per-fee flag values are untouched by this column drop.
ALTER TABLE public.provider_agreements DROP COLUMN "gstApplicable";
