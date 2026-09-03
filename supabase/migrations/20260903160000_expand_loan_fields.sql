-- There was no manual "Add Loan" form anywhere in the app — loans could only be created via an
-- AI-parsed loan-document proposal. Adding a proper manual form (modelled loosely on richer
-- mortgage-tracking tools) needs these additional fields; all nullable/additive, nothing existing
-- reads or requires them yet.
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS "bsb" text,
  ADD COLUMN IF NOT EXISTS "accountNumber" text,
  ADD COLUMN IF NOT EXISTS "loanType" text,
  ADD COLUMN IF NOT EXISTS "purpose" text,
  ADD COLUMN IF NOT EXISTS "originalAmount" numeric,
  ADD COLUMN IF NOT EXISTS "creditLimit" numeric,
  ADD COLUMN IF NOT EXISTS "rateType" text,
  ADD COLUMN IF NOT EXISTS "repaymentFrequency" text,
  ADD COLUMN IF NOT EXISTS "nextRepaymentDate" text,
  ADD COLUMN IF NOT EXISTS "startDate" text,
  ADD COLUMN IF NOT EXISTS "maturityDate" text,
  ADD COLUMN IF NOT EXISTS "hasOffsetAccount" boolean,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz;
