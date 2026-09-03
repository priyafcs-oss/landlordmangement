-- Data fix: mapExpenseCategory/mapBillType checked "rates" before "water", so an AI-extracted
-- category of "water_rates" (a common label for a water bill) matched the generic council/rates
-- branch first and got filed as Council Rates instead of Water Charges. Fixed going forward in
-- src/lib/calculations.ts and supabase/functions/parse-inbound-bill/core-parser.ts; this corrects
-- the rows that were already miscategorized before that fix landed.
UPDATE public.expenses
SET category = 'Water Charges'
WHERE category = 'Council Rates' AND notes = 'water_rates';
