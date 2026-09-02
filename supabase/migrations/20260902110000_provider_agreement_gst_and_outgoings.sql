-- Two problems with the fee terms on provider_agreements (added in 20260902100000):
-- 1. "gstApplicable" is one flag for the WHOLE agreement, multiplying every fee by 1.1 uniformly —
--    but a real agreement can state one fee as "4% plus GST" and another as "$50 inclusive of
--    GST" in the same document. A single global flag can't represent both, and the AI extraction
--    prompt was folding a "plus GST" rate into its GST-inclusive equivalent before storage, which
--    then got GST applied to it AGAIN by the global flag — a double-count. Each fee now gets its
--    own "*GstInclusive" flag; feeVerification.ts's effectiveRate() applies GST only when
--    gstApplicable is true AND that specific fee's own flag is false.
-- 2. Several fee/term types landlords track weren't captured at all: lease preparation fee, NCAT/
--    tribunal fee, how many inspections/year the agreement commits to, and whether the agent pays
--    water usage/land tax/council rates from rental proceeds on the owner's behalf.
ALTER TABLE public.provider_agreements
  ADD COLUMN "managementFeeGstInclusive" boolean,
  ADD COLUMN "lettingFeeGstInclusive" boolean,
  ADD COLUMN "adminFeeGstInclusive" boolean,
  ADD COLUMN "leaseRenewalFeeGstInclusive" boolean,
  ADD COLUMN "inspectionFeeGstInclusive" boolean,
  ADD COLUMN "advertisingFeeGstInclusive" boolean,
  ADD COLUMN "leasePreparationFeeAmount" numeric,
  ADD COLUMN "leasePreparationFeeGstInclusive" boolean,
  ADD COLUMN "ncatFeeAmount" numeric,
  ADD COLUMN "ncatFeeGstInclusive" boolean,
  ADD COLUMN "inspectionsPerYear" numeric,
  ADD COLUMN "agentPaysWaterUsage" boolean,
  ADD COLUMN "agentPaysLandTax" boolean,
  ADD COLUMN "agentPaysCouncilRates" boolean;
