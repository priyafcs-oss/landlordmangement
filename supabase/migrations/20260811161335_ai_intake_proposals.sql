-- Staging table for AI-parsed lease agreements and rent statements. Unlike
-- bills (auto-approved into expenses unless flagged), these always require
-- explicit landlord confirmation before touching tenants/ledger_entries —
-- see parse-inbound-bill/parse-lease.ts and parse-ledger.ts.
CREATE TABLE public.ai_intake_proposals (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('tenant_lease', 'rent_ledger')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  "propertyId" text,
  "matchedTenantId" text,
  "rawPropertyAddress" text,
  "sourceSubject" text,
  "emailMessageId" text,
  "sourceFileName" text,
  "sourceFileData" text,
  "sourceEmailBody" text,
  payload jsonb NOT NULL,
  "reviewReason" text
);

CREATE UNIQUE INDEX ai_intake_proposals_email_message_id_key
  ON public.ai_intake_proposals ("emailMessageId")
  WHERE "emailMessageId" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_intake_proposals TO anon, authenticated;
GRANT ALL ON public.ai_intake_proposals TO service_role;
ALTER TABLE public.ai_intake_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single_landlord_app_access" ON public.ai_intake_proposals
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
