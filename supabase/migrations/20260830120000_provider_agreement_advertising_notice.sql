-- Two more standard Property Management Agreement terms alongside the fee fields added in
-- 20260827110000: the one-off marketing/advertising fee charged when a property is listed for a
-- new tenant, and the notice period either side must give to end the agreement.
ALTER TABLE public.providers
  ADD COLUMN "advertisingFeeAmount" numeric,
  ADD COLUMN "noticePeriodDays" numeric;
