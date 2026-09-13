-- DVS Utility v2.0 — abilita DCP Video nello storico esistente.
-- Eseguire una sola volta nel SQL Editor del progetto Supabase DVS Utility.

alter table public.dcp_audio_reports
add column if not exists report_type text not null default 'audio';

update public.dcp_audio_reports
set report_type = 'audio'
where report_type is null or report_type not in ('audio', 'video');

alter table public.dcp_audio_reports
drop constraint if exists dcp_audio_reports_report_type_check;

alter table public.dcp_audio_reports
add constraint dcp_audio_reports_report_type_check
check (report_type in ('audio', 'video'));
