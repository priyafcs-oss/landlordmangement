-- Lets a bank statement upload be pre-targeted at one specific BankAccount (the "Upload
-- statement" button on that account), the same way loanIdHint already pre-targets a loan
-- statement at one specific Loan — the account's own "Compiled bank feed"/"Statement files"
-- sections filter on this instead of showing every bank_statement proposal across the portfolio.
ALTER TABLE public.ai_intake_proposals ADD COLUMN "bankAccountId" text;
