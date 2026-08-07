-- Erebe wish list — core schema.
-- All tables have RLS enabled with NO policies granted to anon/authenticated:
-- every read/write goes through the SECURITY DEFINER functions in 002_functions_and_grants.sql,
-- which run as the table owner and therefore bypass RLS. This keeps donor emails and
-- passcode hashes from ever being reachable directly over the PostgREST API.

create extension if not exists pgcrypto;

create table wishlist_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('volunteer','material')),
  name text not null,
  description text,
  target_quantity numeric,
  unit text,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table donors (
  id uuid primary key default gen_random_uuid(),
  chosen_name text not null,
  chosen_name_lower text generated always as (lower(chosen_name)) stored,
  passcode_hash text not null,
  contact_name text not null,
  email text not null,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chosen_name_lower)
);

create table donor_sessions (
  token uuid primary key default gen_random_uuid(),
  donor_id uuid not null references donors(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create table admin_sessions (
  token uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create table contributions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references wishlist_items(id),
  donor_id uuid not null references donors(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  quantity_note text,
  on_build_crew boolean,
  arrival_date date,
  departure_date date,
  loan_or_donated text check (loan_or_donated in ('loan','donated')),
  pickup_method text,
  pickup_method_other text,
  pickup_timing text,
  pickup_timing_other text,
  pickup_location text,
  care_instructions text,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table change_requests (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references contributions(id) on delete cascade,
  requested_quantity numeric, -- null = "remove entirely"
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  admin_note text
);

create index on contributions (item_id);
create index on contributions (donor_id);
create index on change_requests (contribution_id);
create index on change_requests (status);
create index on donor_sessions (donor_id);

alter table wishlist_items enable row level security;
alter table donors enable row level security;
alter table donor_sessions enable row level security;
alter table admin_sessions enable row level security;
alter table contributions enable row level security;
alter table change_requests enable row level security;
