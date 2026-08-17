CREATE TABLE public.valuation_snapshots (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "assetId" text NOT NULL,
  date date NOT NULL,
  value numeric NOT NULL
);

CREATE TABLE public.loan_balance_snapshots (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "loanId" text NOT NULL,
  date date NOT NULL,
  balance numeric NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.valuation_snapshots TO authenticated;
GRANT ALL ON public.valuation_snapshots TO service_role;
ALTER TABLE public.valuation_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.valuation_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_balance_snapshots TO authenticated;
GRANT ALL ON public.loan_balance_snapshots TO service_role;
ALTER TABLE public.loan_balance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON public.loan_balance_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);
