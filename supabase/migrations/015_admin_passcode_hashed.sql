-- ALREADY APPLIED to the live project (Supabase migration version 20261103104309,
-- name "admin_passcode_hashed") from a Claude chat on 2026-11-03. Recorded here so the
-- repo matches the database. Do NOT re-run.
--
-- Replaces the hardcoded admin passcode from 002_functions_and_grants.sql with a bcrypt
-- hash stored in admin_credentials. The passcode itself is never stored in this repo.

create table if not exists public.admin_credentials (
  id int primary key default 1 check (id = 1),
  passcode_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.admin_credentials enable row level security;
revoke all on public.admin_credentials from anon, authenticated;

create or replace function public.admin_login(p_name text, p_passcode text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_token uuid; v_hash text;
begin
  select passcode_hash into v_hash from admin_credentials where id = 1;
  if v_hash is null
     or lower(trim(coalesce(p_name,''))) <> 'admin'
     or extensions.crypt(coalesce(p_passcode,''), v_hash) <> v_hash then
    raise exception 'incorrect_credentials';
  end if;
  insert into admin_sessions default values returning token into v_token;
  return v_token;
end;
$function$;
-- The passcode hash was inserted separately and is intentionally not recorded here.
