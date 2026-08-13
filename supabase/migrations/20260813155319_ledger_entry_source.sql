-- Tracks how a ledger entry was posted (manual Post Payment, bank feed match, or
-- an applied AI rent-statement proposal), so the ledger can show provenance per row.
ALTER TABLE public.ledger_entries
  ADD COLUMN source text CHECK (source IN ('manual', 'bank_feed', 'rent_statement'));
