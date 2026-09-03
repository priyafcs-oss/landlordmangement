-- Per-loan statement history: one row per applied "loan_statement" proposal, richer than
-- loan_balance_snapshots (which only ever captures date+balance) — this carries the
-- interest/principal split and a link back to the source document, driving a per-loan
-- "Statement history" chart/list. Coexists with loan_balance_snapshots rather than replacing
-- it: that table is the single feed for the portfolio-wide "Loan balance trend" chart on the
-- Dashboard and is populated by ANY balance-changing edit (manual or statement-driven) —
-- narrowing it to only statement-applied edits would lose fidelity for loans whose balance is
-- kept current by hand. Applying a statement will still also produce a loan_balance_snapshots
-- row (same closingBalance, same date) via updateLoan's existing snapshot-on-totalBalance-change
-- behavior — that overlap is intentional, not a bug.
CREATE TABLE public.loan_statements (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "loanId" text NOT NULL,
  "propertyId" text,
  "periodStart" date,
  "periodEnd" date,
  "interestCharged" numeric,
  "principalPaid" numeric,
  "repaymentsMade" numeric,
  "closingBalance" numeric,
  "sourceFileName" text,
  "sourceFileData" text,
  "proposalId" text,
  "appliedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loan_statements_loan_id_idx ON public.loan_statements ("loanId");

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_statements TO anon, authenticated;
GRANT ALL ON public.loan_statements TO service_role;
ALTER TABLE public.loan_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single_landlord_app_access" ON public.loan_statements
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
