-- A true "every email received" trail for the forwarding inbox — distinct from
-- ai_intake_proposals, which only ever gets a row when classification/extraction
-- actually succeeds. This logs every inbound email the webhook is invoked for,
-- including ones that fail or get silently skipped, so a forwarded document
-- never just vanishes without a trace. See parse-inbound-bill/index.ts.
CREATE TABLE public.email_inbox_log (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  "emailId" text,
  "fromAddress" text,
  subject text,
  "hasAttachment" boolean NOT NULL DEFAULT false,
  "attachmentFileName" text,
  status text NOT NULL CHECK (status IN ('processed', 'staged', 'skipped', 'failed')),
  "documentType" text,
  "proposalId" text,
  "expenseId" text,
  "errorMessage" text
);

CREATE UNIQUE INDEX email_inbox_log_email_id_key
  ON public.email_inbox_log ("emailId")
  WHERE "emailId" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_inbox_log TO anon, authenticated;
GRANT ALL ON public.email_inbox_log TO service_role;
ALTER TABLE public.email_inbox_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "single_landlord_app_access" ON public.email_inbox_log
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
