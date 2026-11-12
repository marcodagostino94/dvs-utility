-- Utility 4.1: cartelle separate nei quattro storici.
-- Eseguire dopo le migrazioni 001–005. Nessun documento viene eliminato.
begin;
create table if not exists public.archive_folders (
 id uuid primary key default gen_random_uuid(),
 scope text not null check (scope in ('audio','video','episode','technical')),
 name text not null check (length(trim(name)) > 0),
 created_at timestamptz not null default now()
);
create unique index if not exists archive_folders_scope_name on public.archive_folders(scope, lower(name));
alter table public.archive_folders enable row level security;
-- Stesso modello di accesso condiviso già utilizzato dagli storici Utility.
drop policy if exists archive_folders_shared on public.archive_folders;
create policy archive_folders_shared on public.archive_folders
 for all to anon, authenticated using (true) with check (true);
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.archive_folders to anon, authenticated;
alter table public.dcp_audio_reports add column if not exists folder_id uuid references public.archive_folders(id) on delete set null;
alter table public.technical_sheets add column if not exists folder_id uuid references public.archive_folders(id) on delete set null;
alter table public.technical_pdf_files add column if not exists folder_id uuid references public.archive_folders(id) on delete set null;
create index if not exists dcp_reports_folder on public.dcp_audio_reports(folder_id);
create index if not exists technical_sheets_folder on public.technical_sheets(folder_id);
create index if not exists technical_pdf_folder on public.technical_pdf_files(folder_id);
commit;
