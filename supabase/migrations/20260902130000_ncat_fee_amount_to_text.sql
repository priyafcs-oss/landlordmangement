-- NCAT/tribunal fees are commonly quoted as a rate ("$50/hour", "$50 per hour or flat $200") not
-- a single flat dollar amount, so the numeric column from 20260902110000 can't hold what agents
-- actually write. Free text instead, same as contractNotes.
ALTER TABLE public.provider_agreements ALTER COLUMN "ncatFeeAmount" TYPE text USING "ncatFeeAmount"::text;
