-- Every photo/video/PDF/document in this app has always been stored as base64 text directly in
-- Postgres columns (see property_annual_costs_media.sql, app_settings_lease_template.sql, and the
-- {name,data}/{fileName,fileData} pattern repeated across tenants, expenses, bills, loans,
-- depreciation reports, providers, inspections, compliance certificates, property notes). Since
-- every table is fetched in full (`select("*")`, see src/lib/db.ts) on every app load
-- (src/lib/store.tsx loads the whole portfolio on mount), every file's bytes were re-downloaded on
-- every single page load — the actual driver of the Supabase egress overage this migration fixes.
--
-- This bucket replaces those base64 columns' CONTENTS (not their names/types — a jsonb/text
-- column that held base64 now holds a "storage:<path>" marker string instead) with real Storage
-- objects, fetched only when a file is actually opened/viewed rather than on every table load.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Path convention: "<owner_id>/<uuid>-<filename>" — mirrors every table's own
-- `owner_id = auth.uid()` RLS scoping (see 20260913100000_multi_tenant_owner_scoping.sql), so a
-- landlord can only read/write objects under their own folder.
create policy "owner_read_documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner_write_documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner_update_documents"
  on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner_delete_documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
