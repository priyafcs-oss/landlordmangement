-- The Inbox view previously only reflected email_inbox_log's contents at the moment the app
-- happened to load (see src/lib/store.tsx's single mount-time refresh()) — an email the webhook
-- finished processing while the landlord already had the app open in a tab simply never appeared
-- until a manual reload. Adding this table to Supabase's realtime publication lets the client
-- subscribe to live INSERT/UPDATE/DELETE events on it (see db.ts's subscribeToTable) instead.
-- Existing RLS policies on the table still apply to what a subscriber actually receives.
alter publication supabase_realtime add table public.email_inbox_log;
