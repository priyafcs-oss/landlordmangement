-- The loan-document extraction (and the manual Add Loan form) had no field for the lender's own
-- product name (e.g. "Home Loan", "Investment Loan", "Line of Credit") — distinct from loanType
-- (Principal & Interest / Interest Only) and purpose (Investment / Owner Occupied), which are
-- different axes and shouldn't be conflated with it.
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS "productType" text;
