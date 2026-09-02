-- The email webhook (parse-inbound-bill/index.ts) used to pick exactly ONE "most likely"
-- attachment off a forwarded email and silently ignore every other one — so an email with several
-- genuine attachments (e.g. three separate water bills batched into one forward) only ever
-- processed the first, unlike the manual Upload dialog, which now processes every selected file.
-- The webhook now loops over every real (non-inline) attachment and calls the same
-- classify/extract/stage pipeline once per attachment, so email intake matches manual bulk upload.
--
-- email_inbox_log's uniqueness was on emailId alone (one row per email) — with multiple documents
-- now possibly coming from one email, it needs its own row per attachment, deduped on
-- (emailId, attachmentId) instead so a Svix webhook retry for the same email+attachment still
-- upserts cleanly rather than duplicating.
ALTER TABLE public.email_inbox_log ADD COLUMN "attachmentId" text;

DROP INDEX IF EXISTS public.email_inbox_log_email_id_key;
CREATE UNIQUE INDEX email_inbox_log_email_id_attachment_id_key
  ON public.email_inbox_log ("emailId", "attachmentId");
