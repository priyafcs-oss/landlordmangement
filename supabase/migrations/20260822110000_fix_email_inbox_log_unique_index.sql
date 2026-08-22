-- The original partial unique index (WHERE "emailId" IS NOT NULL) can't serve as an ON CONFLICT
-- ("emailId") target unless the upsert repeats that exact predicate, which the app doesn't do.
-- Every insert since table creation has been failing with 42P10 ("no unique or exclusion
-- constraint matching the ON CONFLICT specification"), so the Inbox has silently logged nothing.
-- emailId is always set before logEmailInbox is called (see parse-inbound-bill/index.ts), so a
-- plain non-partial unique index is both correct and sufficient here.
DROP INDEX IF EXISTS public.email_inbox_log_email_id_key;

CREATE UNIQUE INDEX email_inbox_log_email_id_key
  ON public.email_inbox_log ("emailId");
