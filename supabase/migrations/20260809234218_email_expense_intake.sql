-- Email-to-Expense intake: adds an auto-approve/needs-review workflow to
-- expenses, plus BPAY and email-provenance fields for bills parsed by the
-- parse-inbound-bill edge function.
ALTER TABLE public.expenses
  ADD COLUMN status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('needs_review', 'approved', 'paid')),
  ADD COLUMN source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'email_auto')),
  ADD COLUMN "bpayBillerCode" text,
  ADD COLUMN "bpayReference" text,
  ADD COLUMN "paidDate" text,
  ADD COLUMN "rawPropertyAddress" text,
  ADD COLUMN "emailMessageId" text,
  ADD COLUMN "reviewReason" text,
  ALTER COLUMN "propertyId" DROP NOT NULL;

-- Idempotency: a retried webhook for the same inbound email must not create a duplicate expense.
CREATE UNIQUE INDEX expenses_email_message_id_key
  ON public.expenses ("emailMessageId")
  WHERE "emailMessageId" IS NOT NULL;
