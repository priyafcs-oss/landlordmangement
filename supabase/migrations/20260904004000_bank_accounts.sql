-- Cash bank accounts held under an Entity — Institution/BSB/account number/current balance,
-- distinct from Loan (which already has its own dedicated add/edit workflow with AI document
-- extraction, statement history, offset tracking etc.) so a cash account never gets confused
-- with a loan account or loses those loan-specific records.
CREATE TABLE public.bank_accounts (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz,
  "entityId" text NOT NULL,
  institution text,
  "accountName" text NOT NULL DEFAULT '',
  "accountType" text NOT NULL DEFAULT 'Transaction',
  bsb text,
  "accountNumber" text,
  "currentBalance" numeric NOT NULL DEFAULT 0,
  notes text
);

CREATE INDEX bank_accounts_entity_id_idx ON public.bank_accounts ("entityId");

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO anon, authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single_landlord_app_access" ON public.bank_accounts
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
