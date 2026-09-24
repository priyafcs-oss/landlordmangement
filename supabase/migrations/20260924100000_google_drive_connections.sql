-- Per-landlord Google Drive connection, for the Supabase Storage -> Google Drive file storage
-- migration. Each landlord authorizes the app against their OWN Google Drive account (OAuth,
-- scope drive.file — the app can only ever see files/folders it itself creates), and the
-- resulting refresh token is stored encrypted via Supabase Vault, never in a plain column —
-- same pattern as 20260917120000_provider_portal_password_vault.sql's provider portal password.
--
-- One structural difference from that migration: the OAuth callback (oauth-google-drive-callback)
-- is invoked by Google's own browser redirect, so it carries no Supabase session/JWT at all —
-- there is no auth.uid() to check the write against. So the WRITE side here is an explicit
-- owner-id-parameterized RPC restricted to service_role (never authenticated), rather than a
-- SECURITY DEFINER function that reads auth.uid() internally. The READ side still has both forms:
-- a self-service one for the signed-in caller's own row, and an owner-parameterized one for
-- service-role server contexts (the inbound-email webhook, export-backup, the migration script)
-- that resolve owner_id themselves.

create table public.google_drive_connections (
  owner_id uuid primary key references auth.users(id) default auth.uid(),
  refresh_token_secret_id uuid,
  connected_email text,
  root_folder_id text,
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.google_drive_connections enable row level security;

-- Read-only for the owner themselves (Settings shows connection status/email directly) — no
-- insert/update/delete policy for `authenticated`; every write goes through the RPCs below, so a
-- row's refresh_token_secret_id can never be set out of lockstep with the Vault secret it points to.
create policy "select own google drive connection"
  on public.google_drive_connections for select
  to authenticated
  using (owner_id = auth.uid());

create or replace function public.admin_upsert_google_drive_connection(
  p_owner_id uuid,
  p_refresh_token text,
  p_connected_email text,
  p_root_folder_id text
)
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select refresh_token_secret_id into v_secret_id
  from public.google_drive_connections where owner_id = p_owner_id;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_refresh_token, 'google_drive_refresh_token_' || p_owner_id);
  else
    perform vault.update_secret(v_secret_id, p_refresh_token);
  end if;

  insert into public.google_drive_connections (owner_id, refresh_token_secret_id, connected_email, root_folder_id, status, connected_at, updated_at)
  values (p_owner_id, v_secret_id, p_connected_email, p_root_folder_id, 'connected', now(), now())
  on conflict (owner_id) do update set
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    connected_email = excluded.connected_email,
    root_folder_id = excluded.root_folder_id,
    status = 'connected',
    connected_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.get_my_google_drive_refresh_token()
returns text
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_token text;
begin
  select refresh_token_secret_id into v_secret_id
  from public.google_drive_connections where owner_id = auth.uid();

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
  return v_token;
end;
$$;

create or replace function public.admin_get_google_drive_refresh_token(p_owner_id uuid)
returns text
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_token text;
begin
  select refresh_token_secret_id into v_secret_id
  from public.google_drive_connections where owner_id = p_owner_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
  return v_token;
end;
$$;

create or replace function public.disconnect_google_drive()
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select refresh_token_secret_id into v_secret_id
  from public.google_drive_connections where owner_id = auth.uid();

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  update public.google_drive_connections
  set refresh_token_secret_id = null, status = 'disconnected', root_folder_id = null, connected_email = null
  where owner_id = auth.uid();
end;
$$;

-- Only service_role may write a connection (the OAuth callback has no user session to check
-- against — see the comment at the top of this file) or read another owner's token (server
-- contexts that resolve owner_id themselves: the inbound-email webhook, export-backup, the
-- storage->Drive migration script).
grant execute on function public.admin_upsert_google_drive_connection(uuid, text, text, text) to service_role;
grant execute on function public.admin_get_google_drive_refresh_token(uuid) to service_role;

-- A signed-in landlord may read/clear only their own token.
grant execute on function public.get_my_google_drive_refresh_token() to authenticated;
grant execute on function public.disconnect_google_drive() to authenticated;
