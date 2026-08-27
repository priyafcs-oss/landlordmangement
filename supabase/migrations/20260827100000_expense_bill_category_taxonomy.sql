-- Adds the specific ATO category (e.g. "Water Charges", "Capital Improvement") alongside the
-- existing coarse taxCategory (Immediate Deduction / Capital Works) on both expenses and
-- property_bills. expenses.category was already being written by AddTransactionDialog before
-- this migration, but the column never existed -- PostgREST silently rejected every upsert
-- containing it, so no historical row actually has a value here; nothing to backfill.
ALTER TABLE public.expenses
  ADD COLUMN category text;

ALTER TABLE public.property_bills
  ADD COLUMN category text;
