-- Volunteer hour tracking: anyone with a login can log the days/hours they worked so
-- they get credit for the build (now and on future builds). Entries count immediately;
-- admins can add, fix, or delete entries for anyone. Same pattern as every other table:
-- RLS on, no policies, only reachable through the SECURITY DEFINER RPCs below.

create table work_logs (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references donors(id) on delete cascade,
  work_date date not null,
  hours numeric(4,2) not null check (hours > 0 and hours <= 24),
  note text,
  entered_by text not null default 'self' check (entered_by in ('self','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index work_logs_donor_idx on work_logs(donor_id, work_date desc);
alter table work_logs enable row level security;

-- ============ volunteer self-service ============
create or replace function log_my_hours(p_session_token uuid, p_work_date date, p_hours numeric, p_note text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid; v_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  if p_work_date is null then raise exception 'work_date_required'; end if;
  if p_work_date > current_date + 1 then raise exception 'work_date_in_future'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 then raise exception 'hours_out_of_range'; end if;
  insert into work_logs (donor_id, work_date, hours, note)
  values (v_donor_id, p_work_date, round(p_hours, 2), nullif(trim(coalesce(p_note,'')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function get_my_hours(p_session_token uuid)
returns table (id uuid, work_date date, hours numeric, note text, entered_by text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  return query
    select w.id, w.work_date, w.hours, w.note, w.entered_by, w.created_at
    from work_logs w where w.donor_id = v_donor_id
    order by w.work_date desc, w.created_at desc;
end;
$$;

create or replace function delete_my_hours(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  delete from work_logs where id = p_id and donor_id = v_donor_id;
end;
$$;

-- ============ admin ============
create or replace function admin_get_hours(p_session_token uuid)
returns table (
  id uuid, donor_id uuid, chosen_name text, contact_name text,
  work_date date, hours numeric, note text, entered_by text, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return query
    select w.id, w.donor_id, d.chosen_name, d.contact_name,
           w.work_date, w.hours, w.note, w.entered_by, w.created_at
    from work_logs w join donors d on d.id = w.donor_id
    order by w.work_date desc, w.created_at desc;
end;
$$;

-- p_id null = add a new entry for p_donor_id; otherwise edit that entry.
create or replace function admin_upsert_hours(
  p_session_token uuid, p_id uuid, p_donor_id uuid, p_work_date date, p_hours numeric, p_note text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if p_work_date is null then raise exception 'work_date_required'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 then raise exception 'hours_out_of_range'; end if;
  if p_id is null then
    insert into work_logs (donor_id, work_date, hours, note, entered_by)
    values (p_donor_id, p_work_date, round(p_hours, 2), nullif(trim(coalesce(p_note,'')), ''), 'admin')
    returning id into v_id;
  else
    update work_logs
      set work_date = p_work_date, hours = round(p_hours, 2),
          note = nullif(trim(coalesce(p_note,'')), ''), updated_at = now()
      where id = p_id
      returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function admin_delete_hours(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  delete from work_logs where id = p_id;
end;
$$;

grant execute on function log_my_hours(uuid, date, numeric, text) to anon, authenticated;
grant execute on function get_my_hours(uuid) to anon, authenticated;
grant execute on function delete_my_hours(uuid, uuid) to anon, authenticated;
grant execute on function admin_get_hours(uuid) to anon, authenticated;
grant execute on function admin_upsert_hours(uuid, uuid, uuid, date, numeric, text) to anon, authenticated;
grant execute on function admin_delete_hours(uuid, uuid) to anon, authenticated;
