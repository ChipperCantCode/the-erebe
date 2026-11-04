-- ALREADY APPLIED to the live project (Supabase migration version 20261103104416,
-- name "portfolio_tables") from a Claude chat on 2026-11-03. Recorded here so the repo
-- matches the database. Do NOT re-run.
--
-- Inani's art portfolio: one row per project, its photos, and a single-row page table
-- for the intro quote and credits footer. Locked down like every other table here (RLS
-- on, no grants) -- only reachable through RPCs.

create table public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  year_label text,
  sort_year int,
  event text,
  role text,
  credit text,
  body_html text not null default '',
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portfolio_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.portfolio_projects(id) on delete cascade,
  storage_path text not null,
  caption text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.portfolio_photos (project_id, sort_order);

create table public.portfolio_page (
  id int primary key default 1 check (id = 1),
  intro_quote text,
  intro_html text,
  footer_html text,
  updated_at timestamptz not null default now()
);

alter table public.portfolio_projects enable row level security;
alter table public.portfolio_photos enable row level security;
alter table public.portfolio_page enable row level security;
revoke all on public.portfolio_projects, public.portfolio_photos, public.portfolio_page from anon, authenticated;

-- get_portfolio() was created here and replaced in the next migration.
-- (The 16 projects' text and the portfolio_page row were loaded as data, not as a migration.)
