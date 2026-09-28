-- DVS Utility v3.9 — archivio PDF delle Schede Tecniche RAI.
-- Eseguire una sola volta nel SQL Editor del progetto Supabase DVS Utility.
-- Comprende i privilegi espliciti richiesti dalle nuove impostazioni Supabase.

create extension if not exists pgcrypto;

create table if not exists public.technical_pdf_files (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  file_size bigint not null default 0,
  mime_type text not null default 'application/pdf',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.technical_pdf_files enable row level security;

drop policy if exists "technical_pdf_files_select" on public.technical_pdf_files;
drop policy if exists "technical_pdf_files_insert" on public.technical_pdf_files;
drop policy if exists "technical_pdf_files_update" on public.technical_pdf_files;
drop policy if exists "technical_pdf_files_delete" on public.technical_pdf_files;

create policy "technical_pdf_files_select" on public.technical_pdf_files for select to anon, authenticated using (true);
create policy "technical_pdf_files_insert" on public.technical_pdf_files for insert to anon, authenticated with check (true);
create policy "technical_pdf_files_update" on public.technical_pdf_files for update to anon, authenticated using (true) with check (true);
create policy "technical_pdf_files_delete" on public.technical_pdf_files for delete to anon, authenticated using (true);

create or replace function public.set_technical_pdf_files_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists technical_pdf_files_updated_at on public.technical_pdf_files;
create trigger technical_pdf_files_updated_at
before update on public.technical_pdf_files
for each row execute function public.set_technical_pdf_files_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('technical-sheets-pdf', 'technical-sheets-pdf', false, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "technical_pdf_storage_select" on storage.objects;
drop policy if exists "technical_pdf_storage_insert" on storage.objects;
drop policy if exists "technical_pdf_storage_update" on storage.objects;
drop policy if exists "technical_pdf_storage_delete" on storage.objects;

create policy "technical_pdf_storage_select" on storage.objects for select to anon, authenticated using (bucket_id = 'technical-sheets-pdf');
create policy "technical_pdf_storage_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'technical-sheets-pdf');
create policy "technical_pdf_storage_update" on storage.objects for update to anon, authenticated using (bucket_id = 'technical-sheets-pdf') with check (bucket_id = 'technical-sheets-pdf');
create policy "technical_pdf_storage_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'technical-sheets-pdf');

grant usage on schema public, storage to anon, authenticated;
grant select, insert, update, delete on table public.technical_pdf_files to anon, authenticated;
grant select, insert, update, delete on table storage.objects to anon, authenticated;
