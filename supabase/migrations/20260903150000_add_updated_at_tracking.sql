-- Transactions and Bills only ever showed created_at (when a row was first added) — there was no
-- way to tell "last modified" apart from "first added", so editing an old expense/bill/ledger
-- entry left no visible trace. Nullable, no default/backfill: NULL means "never edited since it
-- was added" (the UI falls back to created_at in that case), not "unknown".
--
-- Named "updatedAt" (camelCase, quoted) rather than snake_case updated_at — created_at is the
-- one legacy snake_case column from this schema's original generator; every column added since
-- (propertyId, invoiceFileName, ...) is camelCase, and the app code (store.tsx/types.ts) sends
-- the JSON key "updatedAt" verbatim through PostgREST, which does no camelCase<->snake_case
-- translation — the column name has to match the JSON key exactly.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz;
ALTER TABLE public.property_bills ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz;
ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz;
