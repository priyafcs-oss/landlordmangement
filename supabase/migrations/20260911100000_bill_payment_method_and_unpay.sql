-- Mark Paid previously only recorded a paid date, with no way to record how a bill was paid, pay
-- a custom (non-full) amount, or undo a mistaken "mark paid" — see BillDetailDialog.tsx.

ALTER TABLE public.property_bills
  ADD COLUMN "paymentMethod" text,
  ADD COLUMN "paidAmount" numeric;

ALTER TABLE public.expenses
  ADD COLUMN "paymentMethod" text;
