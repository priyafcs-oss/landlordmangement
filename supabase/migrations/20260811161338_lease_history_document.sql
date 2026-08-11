-- Archives the lease document that was active during a past lease period,
-- so a renewed lease agreement doesn't overwrite/lose the original.
ALTER TABLE public.lease_history
  ADD COLUMN "leaseDocumentFileName" text,
  ADD COLUMN "leaseDocumentFileData" text;
