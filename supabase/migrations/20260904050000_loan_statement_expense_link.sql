-- Links a loan_statements row back to the deductible Expense its interest portion was posted
-- as (when any was posted), so deleting a wrongly-applied statement (e.g. the same statement
-- approved twice) can also offer to remove the matching interest expense instead of leaving it
-- orphaned in the P&L.
ALTER TABLE public.loan_statements ADD COLUMN "expenseId" text;
