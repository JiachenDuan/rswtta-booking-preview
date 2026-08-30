-- Logical multi-project storage for GitHub Pages frontends.
-- Review and run this in Jiachen's Supabase SQL editor before using the hosted app.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'coach', 'parent', 'viewer')),
  display_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.project_tables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists public.project_columns (
  id uuid primary key default gen_random_uuid(),
  project_table_id uuid not null references public.project_tables(id) on delete cascade,
  slug text not null,
  name text not null,
  data_type text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (project_table_id, slug)
);

create table if not exists public.project_rows (
  id uuid primary key default gen_random_uuid(),
  project_table_id uuid not null references public.project_tables(id) on delete cascade,
  values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_rows_table_idx on public.project_rows(project_table_id);
create index if not exists project_rows_values_gin_idx on public.project_rows using gin(values);

create or replace function public.touch_project_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_project_row_updated_at on public.project_rows;
create trigger touch_project_row_updated_at
before update on public.project_rows
for each row
execute function public.touch_project_row_updated_at();

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_tables enable row level security;
alter table public.project_columns enable row level security;
alter table public.project_rows enable row level security;

-- Prototype policies for this public preview app.
-- Tighten these before production: pair Supabase Auth users to project_members,
-- then scope select/insert/update/delete to the authenticated user's project role.
drop policy if exists "prototype public read projects" on public.projects;
create policy "prototype public read projects" on public.projects
for select using (true);

drop policy if exists "prototype public insert projects" on public.projects;
create policy "prototype public insert projects" on public.projects
for insert with check (true);

drop policy if exists "prototype public read project_members" on public.project_members;
create policy "prototype public read project_members" on public.project_members
for select using (true);

drop policy if exists "prototype public insert project_members" on public.project_members;
create policy "prototype public insert project_members" on public.project_members
for insert with check (true);

drop policy if exists "prototype public read project_tables" on public.project_tables;
create policy "prototype public read project_tables" on public.project_tables
for select using (true);

drop policy if exists "prototype public insert project_tables" on public.project_tables;
create policy "prototype public insert project_tables" on public.project_tables
for insert with check (true);

drop policy if exists "prototype public read project_columns" on public.project_columns;
create policy "prototype public read project_columns" on public.project_columns
for select using (true);

drop policy if exists "prototype public insert project_columns" on public.project_columns;
create policy "prototype public insert project_columns" on public.project_columns
for insert with check (true);

drop policy if exists "prototype public read project_rows" on public.project_rows;
create policy "prototype public read project_rows" on public.project_rows
for select using (true);

drop policy if exists "prototype public insert project_rows" on public.project_rows;
create policy "prototype public insert project_rows" on public.project_rows
for insert with check (true);

drop policy if exists "prototype public update project_rows" on public.project_rows;
create policy "prototype public update project_rows" on public.project_rows
for update using (true) with check (true);
