-- Add "agent_statement" as a distinct source (a fee/rent line read off an agent statement,
-- previously indistinguishable from a plain emailed bill or a generic "uploaded" rent payment)
-- and widen expenses.source to also allow "upload", which the app has been setting since
-- settlement-adjustment expenses were added but was never actually permitted by this constraint --
-- every such insert has been silently failing (upsert errors are only console-logged, never
-- surfaced to the user), so those rows were never actually persisted.
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_source_check,
  ADD CONSTRAINT expenses_source_check CHECK (source IN ('manual', 'email_auto', 'upload', 'agent_statement'));

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_source_check;

UPDATE public.ledger_entries SET source = 'agent_statement' WHERE source = 'rent_statement';

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_source_check CHECK (source IN ('manual', 'bank_feed', 'agent_statement'));
