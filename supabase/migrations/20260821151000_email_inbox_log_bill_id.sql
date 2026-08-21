-- Bills no longer get a paired Expense at intake (see 20260821150000) -- a "processed" email now
-- creates a property_bills row, not an expenses row, so the log's expenseId column would be
-- storing a bill id under a misleading name. Renamed for clarity.
ALTER TABLE public.email_inbox_log RENAME COLUMN "expenseId" TO "billId";
