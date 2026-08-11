-- Preserves the original inbound email's subject/body alongside the already
-- existing invoiceFileName/invoiceFileData attachment columns, so an
-- AI-parsed bill can always be reviewed against its source (PDF and/or
-- email content — either or both may be present).
ALTER TABLE public.expenses
  ADD COLUMN "sourceSubject" text,
  ADD COLUMN "sourceEmailBody" text;
