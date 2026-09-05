-- Lets a property's "Compiled bank feed" (general bank-statement transactions, distinct from the
-- loan-specific one in loan_statements) tell "already recorded as an Expense" apart from "still
-- feed only" for the same transaction line, and lets reverting one ("Unrecord") find the exact
-- Expense it created to delete — same idea as loan_statements."proposalId", but on Expense since
-- a bank-statement transaction becomes an Expense directly, not a loan_statements row.
ALTER TABLE public.expenses
  ADD COLUMN "feedProposalId" text,
  ADD COLUMN "feedLineIndex" integer;
