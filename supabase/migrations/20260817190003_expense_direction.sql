-- Existing rows are all outgoings (the table's original, property-only purpose) — direction is
-- only meaningful (and only ever set) for non-property asset transactions like a gold sale or an
-- ETF dividend, where "cost" alone can't tell you which way the money moved. Every existing
-- Property/Entity-scoped report filters by propertyId, which Gold/ETF rows never have, so this
-- column has zero effect on any figure that already exists.
ALTER TABLE public.expenses ADD COLUMN direction text;
