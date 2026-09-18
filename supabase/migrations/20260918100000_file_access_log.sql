-- Lightweight event log for actually-triggered file downloads (see src/lib/files.ts's
-- getSignedDocumentUrl / src/lib/usage.ts's logFileAccess). Only a signed-URL CACHE MISS is
-- logged — a genuinely new signed URL had to be minted, meaning a real download is about to
-- happen — not a cache hit, which reuses an already-signed URL and triggers no new fetch. This
-- lets a landlord watch, after the base64->Storage migration and the signed-URL caching fix that
-- followed it, whether real file re-downloads (the actual driver of the earlier Supabase egress
-- overage) stay low as they use the app day to day.
create table public.file_access_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index file_access_log_owner_created_idx on public.file_access_log (owner_id, created_at desc);

alter table public.file_access_log enable row level security;

create policy "owner_full_access" on public.file_access_log
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
