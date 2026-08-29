-- Lets a one-off transaction (Expense) carry the vendor/payee it was entered against and its GST
-- component, both of which were previously typed into the Add Transaction dialog but discarded on
-- save -- needed for the Transactions "Provider" column and the income/expense/GST/net footer.
ALTER TABLE public.expenses
  ADD COLUMN "providerName" text;

ALTER TABLE public.expenses
  ADD COLUMN gst numeric;
