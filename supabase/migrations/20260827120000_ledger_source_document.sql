-- Lets a rent-payment ledger row link back to the actual statement it was read off, the same way
-- Expense rows already carry invoiceFileName/invoiceFileData -- Transactions can now show and
-- link to the source document for every row, not just expense-backed ones.
ALTER TABLE public.ledger_entries
  ADD COLUMN "sourceFileName" text,
  ADD COLUMN "sourceFileData" text;
