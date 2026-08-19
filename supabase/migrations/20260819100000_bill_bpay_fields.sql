-- Add Bill's form always collected BPAY biller code/reference separately from the invoice
-- reference number, but property_bills never got columns for them — they were silently dropped
-- on save. Adding them now so the bill detail view can show and edit real BPAY details.

ALTER TABLE public.property_bills
  ADD COLUMN "bpayBillerCode" text,
  ADD COLUMN "bpayReference" text,
  ADD COLUMN source text;
