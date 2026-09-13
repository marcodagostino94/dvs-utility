-- DVS Utility v3.3 — storico Schede Tecniche RAI.
-- Eseguire una sola volta nel SQL Editor del progetto Supabase DVS Utility.

create extension if not exists pgcrypto;

create table if not exists public.technical_sheets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sheet_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.technical_sheets enable row level security;

drop policy if exists "technical_sheets_select" on public.technical_sheets;
drop policy if exists "technical_sheets_insert" on public.technical_sheets;
drop policy if exists "technical_sheets_update" on public.technical_sheets;
drop policy if exists "technical_sheets_delete" on public.technical_sheets;

create policy "technical_sheets_select" on public.technical_sheets for select to anon, authenticated using (true);
create policy "technical_sheets_insert" on public.technical_sheets for insert to anon, authenticated with check (true);
create policy "technical_sheets_update" on public.technical_sheets for update to anon, authenticated using (true) with check (true);
create policy "technical_sheets_delete" on public.technical_sheets for delete to anon, authenticated using (true);

create or replace function public.set_technical_sheets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists technical_sheets_updated_at on public.technical_sheets;
create trigger technical_sheets_updated_at
before update on public.technical_sheets
for each row execute function public.set_technical_sheets_updated_at();
