-- DVS Utility v1.2 — storico dei rapporti DCP Audio.
-- Conserva soltanto il rapporto elaborato: l'EDL originale non viene salvato.

create extension if not exists pgcrypto;

create table if not exists public.dcp_audio_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  report_type text not null default 'audio' check (report_type in ('audio', 'video')),
  rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dcp_audio_reports enable row level security;

drop policy if exists "dcp_audio_reports_select" on public.dcp_audio_reports;
drop policy if exists "dcp_audio_reports_insert" on public.dcp_audio_reports;
drop policy if exists "dcp_audio_reports_update" on public.dcp_audio_reports;
drop policy if exists "dcp_audio_reports_delete" on public.dcp_audio_reports;

create policy "dcp_audio_reports_select" on public.dcp_audio_reports for select to anon, authenticated using (true);
create policy "dcp_audio_reports_insert" on public.dcp_audio_reports for insert to anon, authenticated with check (true);
create policy "dcp_audio_reports_update" on public.dcp_audio_reports for update to anon, authenticated using (true) with check (true);
create policy "dcp_audio_reports_delete" on public.dcp_audio_reports for delete to anon, authenticated using (true);

create or replace function public.set_dcp_audio_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dcp_audio_reports_updated_at on public.dcp_audio_reports;
create trigger dcp_audio_reports_updated_at
before update on public.dcp_audio_reports
for each row execute function public.set_dcp_audio_updated_at();
