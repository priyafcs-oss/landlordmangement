-- Encrypted provider portal-password storage, via Supabase Vault rather than a plain column —
-- "passwordNote" (added in 20260818110000_bill_details_and_linkage.sql) was always meant as a
-- free-text HINT ("same as email password"), not the actual secret; this adds genuine storage for
-- landlords who want the real password kept in-app. The plaintext is never selectable through
-- PostgREST directly (the `vault` schema isn't exposed to it) — only through these two
-- SECURITY DEFINER functions, each re-checking ownership itself (equivalent to the table's own
-- RLS policy) since SECURITY DEFINER bypasses RLS.
alter table public.providers add column if not exists "portalPasswordSecretId" uuid;

create or replace function public.set_provider_portal_password(p_provider_id text, p_password text)
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_owner uuid;
  v_secret_id uuid;
begin
  select owner_id, "portalPasswordSecretId" into v_owner, v_secret_id
  from public.providers where id = p_provider_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Provider not found';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_password, 'provider_portal_password_' || p_provider_id);
    update public.providers set "portalPasswordSecretId" = v_secret_id where id = p_provider_id;
  else
    perform vault.update_secret(v_secret_id, p_password);
  end if;
end;
$$;

create or replace function public.get_provider_portal_password(p_provider_id text)
returns text
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_owner uuid;
  v_secret_id uuid;
  v_password text;
begin
  select owner_id, "portalPasswordSecretId" into v_owner, v_secret_id
  from public.providers where id = p_provider_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Provider not found';
  end if;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_password from vault.decrypted_secrets where id = v_secret_id;
  return v_password;
end;
$$;

create or replace function public.clear_provider_portal_password(p_provider_id text)
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare
  v_owner uuid;
  v_secret_id uuid;
begin
  select owner_id, "portalPasswordSecretId" into v_owner, v_secret_id
  from public.providers where id = p_provider_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Provider not found';
  end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    update public.providers set "portalPasswordSecretId" = null where id = p_provider_id;
  end if;
end;
$$;

grant execute on function public.set_provider_portal_password(text, text) to authenticated;
grant execute on function public.get_provider_portal_password(text) to authenticated;
grant execute on function public.clear_provider_portal_password(text) to authenticated;
