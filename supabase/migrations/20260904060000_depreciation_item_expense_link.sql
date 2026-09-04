-- Links a depreciation_items row back to the Expense it was "assessed" from (Assess depreciation
-- on an existing transaction), so the two never disagree — the source expense's taxCategory is
-- flipped to Capital Works at the same time this column gets set, preventing the same cost being
-- claimed both as an immediate deduction and as a depreciation schedule. Same idea as
-- loan_statements.expenseId (20260904050000), just the reverse direction.
ALTER TABLE public.depreciation_items ADD COLUMN "sourceExpenseId" text;
