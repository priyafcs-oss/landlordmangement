-- Two independent additions:
--
-- 1. loans.sourceFileName/sourceFileData — the offer/contract/approval letter attached in
--    AddLoanDialog's upload pane was being read into the form's local state (to drive AI
--    extraction) but never sent to the server at save time, and the Loan type had nowhere for it
--    to live even if it had been — so the file silently vanished once the dialog closed. These
--    columns give it a permanent home, mirroring loan_statements.sourceFileName/sourceFileData.
--
-- 2. loan_statements.openingBalance/eligibleLenderFee/description/feeExpenseId — support a
--    manually-recorded statement entry (AddLoanStatementDialog) alongside the existing
--    AI-extracted-and-reviewed path: a manual entry states its own opening balance (AI-reviewed
--    statements only ever stated the closing balance) and can carry a one-off lender fee, which
--    posts as its own linked "Borrowing Expenses" expense distinct from the interest one.
ALTER TABLE public.loans
  ADD COLUMN "sourceFileName" text,
  ADD COLUMN "sourceFileData" text;

ALTER TABLE public.loan_statements
  ADD COLUMN "openingBalance" numeric,
  ADD COLUMN "eligibleLenderFee" numeric,
  ADD COLUMN "description" text,
  ADD COLUMN "feeExpenseId" text;
