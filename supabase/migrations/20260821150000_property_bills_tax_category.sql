-- Bills now defer posting to P&L (expenses) until they're actually paid, for every source --
-- previously an AI-confirmed bill posted an Expense immediately at intake, carrying its own
-- atoCategory; property_bills had nowhere to hold that classification for the deferred write
-- markBillPaid performs later. Nullable since existing Unpaid bills predate this column --
-- markBillPaid falls back to "Immediate Deduction" for those, matching today's behavior.
--
-- emailMessageId lets parseInboundBill's retry-idempotency check move from expenses (which a
-- clean bill no longer ever gets a row in at intake) to property_bills, mirroring
-- expenses_email_message_id_key from 20260809234218_email_expense_intake.sql.
ALTER TABLE public.property_bills
  ADD COLUMN "taxCategory" text,
  ADD COLUMN "emailMessageId" text;

CREATE UNIQUE INDEX property_bills_email_message_id_key
  ON public.property_bills ("emailMessageId")
  WHERE "emailMessageId" IS NOT NULL;
