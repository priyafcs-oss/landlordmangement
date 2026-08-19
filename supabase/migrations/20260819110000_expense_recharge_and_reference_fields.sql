-- Recharge-to-tenant on Expense needed a "recharged" idempotency flag (same fix applied to bill
-- line items), and the new Add Transaction dialog collects a reference number and statement
-- period the same way Add Bill does.

ALTER TABLE public.expenses
  ADD COLUMN recharged boolean NOT NULL DEFAULT false,
  ADD COLUMN "referenceNumber" text,
  ADD COLUMN "periodStart" text,
  ADD COLUMN "periodEnd" text,
  ADD COLUMN notes text;
