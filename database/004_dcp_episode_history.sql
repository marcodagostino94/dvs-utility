-- DVS Utility v3.8 — abilita DCP Puntate nello storico esistente.
-- Eseguire una sola volta nel SQL Editor del progetto Supabase DVS Utility.
-- Include i permessi espliciti richiesti dalle nuove impostazioni Supabase.

alter table public.dcp_audio_reports
drop constraint if exists dcp_audio_reports_report_type_check;

alter table public.dcp_audio_reports
add constraint dcp_audio_reports_report_type_check
check (report_type in ('audio', 'video', 'episode'));

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.dcp_audio_reports to anon, authenticated;

-- Le policy RLS già create da 001 restano attive. Le ricreiamo in modo
-- idempotente per rendere questa migrazione sicura anche dopo i cambi Supabase.
alter table public.dcp_audio_reports enable row level security;

drop policy if exists "dcp_audio_reports_select" on public.dcp_audio_reports;
drop policy if exists "dcp_audio_reports_insert" on public.dcp_audio_reports;
drop policy if exists "dcp_audio_reports_update" on public.dcp_audio_reports;
drop policy if exists "dcp_audio_reports_delete" on public.dcp_audio_reports;

create policy "dcp_audio_reports_select" on public.dcp_audio_reports for select to anon, authenticated using (true);
create policy "dcp_audio_reports_insert" on public.dcp_audio_reports for insert to anon, authenticated with check (true);
create policy "dcp_audio_reports_update" on public.dcp_audio_reports for update to anon, authenticated using (true) with check (true);
create policy "dcp_audio_reports_delete" on public.dcp_audio_reports for delete to anon, authenticated using (true);
