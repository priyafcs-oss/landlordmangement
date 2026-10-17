-- Google rejects a stored refresh token for good (invalid_grant) when the landlord revokes access,
-- or — for an OAuth app still in "Testing" publishing status — 7 days after it was issued. That used
-- to fail silently: every gdrive: file stopped opening and new uploads quietly fell back to shared
-- storage, while Settings still said "Connected". The edge functions now flag the row 'error'
-- when that happens, so Settings can show "Reconnect" instead.
--
-- 'error' is already an allowed status. Owners have no update policy on this table (see
-- 20260924100000_google_drive_connections.sql), hence the self-service RPC; service-role contexts
-- update the row directly. Reconnecting goes through admin_upsert_google_drive_connection, which
-- sets status back to 'connected'.

create or replace function public.mark_my_google_drive_expired()
returns void
language sql security definer set search_path = public
as $$
  update public.google_drive_connections
  set status = 'error', updated_at = now()
  where owner_id = auth.uid() and status = 'connected';
$$;

revoke all on function public.mark_my_google_drive_expired() from public, anon;
grant execute on function public.mark_my_google_drive_expired() to authenticated;
