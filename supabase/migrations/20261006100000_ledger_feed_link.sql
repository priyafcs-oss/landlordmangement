-- A bank-statement deposit recorded as a tenant's rent now becomes a ledger_entries row (so it
-- advances their paid-up-to date and shows on the Rental hub ledger), not an Expense — the same
-- feed link expenses got in 20260905010000_expense_feed_link.sql, so the compiled bank feed can
-- still tell that line is already recorded and "Unrecord" can find the exact row to delete.
ALTER TABLE public.ledger_entries
  ADD COLUMN "feedProposalId" text,
  ADD COLUMN "feedLineIndex" integer;
