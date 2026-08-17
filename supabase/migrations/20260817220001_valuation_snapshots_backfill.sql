-- One-time seed: today's actual value for every existing asset/loan, so the trend charts have at
-- least one real data point immediately instead of being empty. Not a guess at past values —
-- just recording what's true today; all future points are captured automatically going forward.
INSERT INTO public.valuation_snapshots (id, "assetId", date, value)
SELECT 'val_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), id, current_date, "currentValue"
FROM public.assets;

INSERT INTO public.loan_balance_snapshots (id, "loanId", date, balance)
SELECT 'lbal_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), id, current_date, "totalBalance"
FROM public.loans;
