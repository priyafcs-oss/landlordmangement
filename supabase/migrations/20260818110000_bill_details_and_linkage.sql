-- Add Bill: richer bill records (instalment grouping, provider/reference/line-items, linked source
-- document) plus provider portal-login fields moved off individual bills onto the provider itself.

ALTER TABLE public.property_bills
  ADD COLUMN "billGroupId" text,
  ADD COLUMN label text,
  ADD COLUMN "providerName" text,
  ADD COLUMN "referenceNumber" text,
  ADD COLUMN "issueDate" text,
  ADD COLUMN "periodStart" text,
  ADD COLUMN "periodEnd" text,
  ADD COLUMN "lineItems" jsonb,
  ADD COLUMN "sourceFileName" text,
  ADD COLUMN "sourceFileData" text,
  ADD COLUMN "linkedExpenseId" text;

ALTER TABLE public.providers
  ADD COLUMN "portalUrl" text,
  ADD COLUMN "portalUsername" text,
  ADD COLUMN "passwordNote" text;
