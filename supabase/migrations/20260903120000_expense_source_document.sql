-- Lets an Expense row link back to the actual statement/letter it was extracted from, distinct
-- from invoiceFileName/invoiceFileData (the real bill/receipt for this specific line, when one
-- exists) -- same split ledger_entries already got in 20260827120000_ledger_source_document.sql.
-- Without this, a rent-statement deduction line had no way to record "here's the agent statement
-- this was read off" separately from "here's the actual invoice", so Transactions' Source and
-- Invoice columns had nothing to tell apart.
ALTER TABLE public.expenses
  ADD COLUMN "sourceFileName" text,
  ADD COLUMN "sourceFileData" text;
