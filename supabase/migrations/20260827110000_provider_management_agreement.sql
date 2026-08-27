-- Property Management Agreement terms, captured on the Agent-role Provider record so a landlord
-- can verify a rent statement's agent deductions (management/letting/admin/renewal/inspection
-- fees) against what they actually signed up for. The contract PDF is kept alongside the
-- extracted fee terms the same way every other document in this app pairs a source file with
-- the fields read off it.
ALTER TABLE public.providers
  ADD COLUMN "contractFileName" text,
  ADD COLUMN "contractFileData" text,
  ADD COLUMN "managementFeePercent" numeric,
  ADD COLUMN "lettingFeeAmount" numeric,
  ADD COLUMN "lettingFeeWeeksRent" numeric,
  ADD COLUMN "adminFeeAmount" numeric,
  ADD COLUMN "adminFeeFrequency" text,
  ADD COLUMN "leaseRenewalFeeAmount" numeric,
  ADD COLUMN "inspectionFeeAmount" numeric,
  ADD COLUMN "contractStartDate" text,
  ADD COLUMN "contractReviewDate" text,
  ADD COLUMN "contractNotes" text;
