-- Volunteer hour logging, admin-scheduled work shifts, and "unclaimed" crew accounts.
--
-- hour_logs: anyone with an account logs when they worked (date, start/end, hours —
--   hours auto-calculated client-side from start/end but overridable) and what they did
--   (one of their volunteer roles, a different volunteer role, or a free-text write-in).
--   role_label is a snapshot of the role name at save time, so the log (and the CSV
--   export Inani hands to whoever gives credit) survives a wish list item being renamed
--   or deleted later.
-- work_shifts / shift_signups: Inani posts "be here for X on this date, from/to" — shown
--   on the homepage — and people sign up from My List. Logging hours against a shift
--   pre-fills the date/times/role from it.
-- donors.claim_code: crew who are physically building but never made an account. Inani
--   creates a placeholder with whatever he knows (playa name, maybe an email), logs
--   their hours, and sends them a claim link (my-list.html?claim=<code>). Claiming either
--   turns the placeholder into their own account (pick a login name + passcode) or, if
--   they already have one, merges its hours/shifts into it. Non-null claim_code = not
--   yet claimed.
--
-- Same security model as everything else: RLS on, no policies, reachable only through
-- the SECURITY DEFINER functions below.

alter table donors add column claim_code text unique;

create table work_shifts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  item_id uuid references wishlist_items(id) on delete set null,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  location text,
  description text,
  show_on_homepage boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shift_signups (
  shift_id uuid not null references work_shifts(id) on delete cascade,
  donor_id uuid not null references donors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shift_id, donor_id)
);

create table hour_logs (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references donors(id) on delete cascade,
  work_date date not null,
  start_time time,
  end_time time,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  item_id uuid references wishlist_items(id) on delete set null,
  role_label text not null,
  shift_id uuid references work_shifts(id) on delete set null,
  note text,
  logged_by text not null default 'self' check (logged_by in ('self','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on hour_logs (donor_id);
create index on hour_logs (work_date);
create index on shift_signups (donor_id);
create index on work_shifts (shift_date);

alter table work_shifts enable row level security;
alter table shift_signups enable row level security;
alter table hour_logs enable row level security;

-- ============ internal helpers (not callable over the API) ============

-- The build is in San Diego; "today" should flip at local midnight, not UTC midnight.
create or replace function erebe_local_today()
returns date
language sql stable set search_path = public
as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

-- Work out what role an hour entry is for: a specific volunteer role, a write-in, or
-- (if neither was given) whatever the linked shift was for.
create or replace function hours_resolve_role(
  p_item_id uuid, p_role_other text, p_shift_id uuid,
  out o_item_id uuid, out o_label text
)
language plpgsql security definer set search_path = public
as $$
begin
  if p_item_id is not null then
    select wi.id, wi.name into o_item_id, o_label
    from wishlist_items wi where wi.id = p_item_id and wi.category = 'volunteer';
    if o_item_id is null then raise exception 'invalid_role'; end if;
  elsif nullif(trim(coalesce(p_role_other, '')), '') is not null then
    o_item_id := null;
    o_label := trim(p_role_other);
  elsif p_shift_id is not null then
    select ws.item_id, coalesce(wi.name, ws.title) into o_item_id, o_label
    from work_shifts ws left join wishlist_items wi on wi.id = ws.item_id
    where ws.id = p_shift_id;
    if o_label is null then raise exception 'role_required'; end if;
  else
    raise exception 'role_required';
  end if;
end;
$$;

create or replace function hours_check_values(p_work_date date, p_hours numeric)
returns void
language plpgsql set search_path = public
as $$
begin
  if p_work_date is null then raise exception 'date_required'; end if;
  if p_work_date > erebe_local_today() + 1 then raise exception 'date_in_future'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 then raise exception 'invalid_hours'; end if;
end;
$$;

create or replace function shift_json(p_shift work_shifts)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p_shift.id, 'title', p_shift.title, 'item_id', p_shift.item_id,
    'role_name', (select wi.name from wishlist_items wi where wi.id = p_shift.item_id),
    'shift_date', p_shift.shift_date, 'start_time', p_shift.start_time, 'end_time', p_shift.end_time,
    'location', p_shift.location, 'description', p_shift.description,
    'show_on_homepage', p_shift.show_on_homepage,
    'signup_count', (select count(*) from shift_signups ss where ss.shift_id = p_shift.id)
  );
$$;

-- ============ public ============

create or replace function get_upcoming_shifts()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(shift_json(ws) order by ws.shift_date, ws.start_time), '[]'::jsonb)
  from work_shifts ws
  where ws.show_on_homepage and ws.shift_date >= erebe_local_today();
$$;

-- ============ donor: hours + shifts ============

create or replace function donor_get_hours_context(p_session_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  return jsonb_build_object(
    'my_roles', (
      select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.sort_order, r.name), '[]'::jsonb)
      from (
        select distinct wi.id, wi.name, wi.sort_order
        from contributions c join wishlist_items wi on wi.id = c.item_id
        where c.donor_id = v_donor_id and c.status = 'active' and wi.category = 'volunteer'
      ) r
    ),
    'all_roles', (
      select coalesce(jsonb_agg(jsonb_build_object('id', wi.id, 'name', wi.name) order by wi.sort_order, wi.name), '[]'::jsonb)
      from wishlist_items wi where wi.category = 'volunteer' and not wi.archived
    ),
    'shifts', (
      select coalesce(jsonb_agg(
        shift_json(ws) || jsonb_build_object(
          'signed_up', exists (select 1 from shift_signups ss where ss.shift_id = ws.id and ss.donor_id = v_donor_id)
        ) order by ws.shift_date, ws.start_time), '[]'::jsonb)
      from work_shifts ws
      where ws.shift_date >= erebe_local_today()
         or exists (select 1 from shift_signups ss where ss.shift_id = ws.id and ss.donor_id = v_donor_id)
    ),
    'logs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', hl.id, 'work_date', hl.work_date, 'start_time', hl.start_time, 'end_time', hl.end_time,
        'hours', hl.hours, 'item_id', hl.item_id, 'role_label', hl.role_label, 'shift_id', hl.shift_id,
        'shift_title', ws.title, 'note', hl.note, 'logged_by', hl.logged_by
      ) order by hl.work_date desc, hl.start_time desc nulls last, hl.created_at desc), '[]'::jsonb)
      from hour_logs hl left join work_shifts ws on ws.id = hl.shift_id
      where hl.donor_id = v_donor_id
    )
  );
end;
$$;

create or replace function donor_save_hours(
  p_session_token uuid, p_id uuid, p_work_date date, p_start_time time, p_end_time time,
  p_hours numeric, p_item_id uuid, p_role_other text, p_shift_id uuid, p_note text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid; v_role record; v_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  perform hours_check_values(p_work_date, p_hours);
  if p_start_time is null or p_end_time is null then raise exception 'times_required'; end if;
  if p_shift_id is not null and not exists (
    select 1 from shift_signups where shift_id = p_shift_id and donor_id = v_donor_id
  ) then
    raise exception 'not_signed_up_for_shift';
  end if;
  select * into v_role from hours_resolve_role(p_item_id, p_role_other, p_shift_id);

  if p_id is null then
    insert into hour_logs (donor_id, work_date, start_time, end_time, hours, item_id, role_label, shift_id, note, logged_by)
    values (v_donor_id, p_work_date, p_start_time, p_end_time, round(p_hours, 2), v_role.o_item_id, v_role.o_label,
            p_shift_id, nullif(trim(coalesce(p_note, '')), ''), 'self')
    returning id into v_id;
  else
    update hour_logs set
      work_date = p_work_date, start_time = p_start_time, end_time = p_end_time, hours = round(p_hours, 2),
      item_id = v_role.o_item_id, role_label = v_role.o_label, shift_id = p_shift_id,
      note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where id = p_id and donor_id = v_donor_id
    returning id into v_id;
    if v_id is null then raise exception 'hours_not_found'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function donor_delete_hours(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  delete from hour_logs where id = p_id and donor_id = v_donor_id;
end;
$$;

create or replace function donor_set_shift_signup(p_session_token uuid, p_shift_id uuid, p_signed_up boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid; v_date date;
begin
  v_donor_id := check_donor_session(p_session_token);
  select shift_date into v_date from work_shifts where id = p_shift_id;
  if v_date is null then raise exception 'shift_not_found'; end if;
  if p_signed_up then
    if v_date < erebe_local_today() then raise exception 'shift_in_past'; end if;
    insert into shift_signups (shift_id, donor_id) values (p_shift_id, v_donor_id) on conflict do nothing;
  else
    delete from shift_signups where shift_id = p_shift_id and donor_id = v_donor_id;
  end if;
end;
$$;

-- ============ claiming an account Inani created ============

create or replace function get_claim_info(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_donor donors%rowtype;
begin
  select * into v_donor from donors where claim_code = p_code and p_code is not null;
  if not found then raise exception 'claim_not_found'; end if;
  return jsonb_build_object(
    'name', v_donor.contact_name,
    'email', nullif(v_donor.email, ''),
    'entries', (select count(*) from hour_logs where donor_id = v_donor.id),
    'hours', (select coalesce(sum(hours), 0) from hour_logs where donor_id = v_donor.id)
  );
end;
$$;

-- Turn the placeholder into the person's own account.
create or replace function claim_account(
  p_code text, p_chosen_name text, p_passcode text, p_contact_name text, p_email text
)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_donor_id uuid; v_token uuid;
begin
  select id into v_donor_id from donors where claim_code = p_code and p_code is not null;
  if v_donor_id is null then raise exception 'claim_not_found'; end if;
  if p_chosen_name is null or trim(p_chosen_name) = '' then raise exception 'chosen_name_required'; end if;
  if p_passcode is null or length(p_passcode) < 3 then raise exception 'passcode_too_short'; end if;
  if p_contact_name is null or trim(p_contact_name) = '' then raise exception 'contact_name_required'; end if;
  if p_email is null or trim(p_email) = '' then raise exception 'email_required'; end if;
  if exists (select 1 from donors where chosen_name_lower = lower(trim(p_chosen_name)) and id <> v_donor_id) then
    raise exception 'name_taken';
  end if;

  update donors set
    chosen_name = trim(p_chosen_name), passcode_hash = crypt(p_passcode, gen_salt('bf')),
    contact_name = trim(p_contact_name), email = trim(p_email), claim_code = null, updated_at = now()
  where id = v_donor_id;

  insert into donor_sessions (donor_id) values (v_donor_id) returning token into v_token;
  return v_token;
end;
$$;

-- They already had an account: fold the placeholder's hours/shifts/items into it.
create or replace function claim_into_account(p_session_token uuid, p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_target uuid; v_placeholder uuid;
begin
  v_target := check_donor_session(p_session_token);
  select id into v_placeholder from donors where claim_code = p_code and p_code is not null;
  if v_placeholder is null then raise exception 'claim_not_found'; end if;
  if v_placeholder = v_target then return; end if;

  update hour_logs set donor_id = v_target, updated_at = now() where donor_id = v_placeholder;
  insert into shift_signups (shift_id, donor_id, created_at)
    select shift_id, v_target, created_at from shift_signups where donor_id = v_placeholder
    on conflict do nothing;
  update contributions set donor_id = v_target, updated_at = now() where donor_id = v_placeholder;
  delete from donors where id = v_placeholder;
end;
$$;

-- ============ admin ============

create or replace function admin_get_hours_dashboard(p_session_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return jsonb_build_object(
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'chosen_name', d.chosen_name, 'contact_name', d.contact_name,
        'email', nullif(d.email, ''), 'claim_code', d.claim_code,
        'total_hours', (select coalesce(sum(hl.hours), 0) from hour_logs hl where hl.donor_id = d.id),
        'entries', (select count(*) from hour_logs hl where hl.donor_id = d.id)
      ) order by lower(d.contact_name)), '[]'::jsonb)
      from donors d
    ),
    'roles', (
      select coalesce(jsonb_agg(jsonb_build_object('id', wi.id, 'name', wi.name) order by wi.sort_order, wi.name), '[]'::jsonb)
      from wishlist_items wi where wi.category = 'volunteer' and not wi.archived
    ),
    'shifts', (
      select coalesce(jsonb_agg(
        shift_json(ws) || jsonb_build_object('signups', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'donor_id', d.id, 'contact_name', d.contact_name, 'chosen_name', d.chosen_name,
            'unclaimed', d.claim_code is not null
          ) order by ss.created_at), '[]'::jsonb)
          from shift_signups ss join donors d on d.id = ss.donor_id
          where ss.shift_id = ws.id
        )) order by ws.shift_date desc, ws.start_time desc), '[]'::jsonb)
      from work_shifts ws
    ),
    'logs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', hl.id, 'donor_id', hl.donor_id, 'contact_name', d.contact_name, 'chosen_name', d.chosen_name,
        'email', nullif(d.email, ''), 'unclaimed', d.claim_code is not null,
        'work_date', hl.work_date, 'start_time', hl.start_time, 'end_time', hl.end_time,
        'hours', hl.hours, 'item_id', hl.item_id, 'role_label', hl.role_label,
        'shift_id', hl.shift_id, 'shift_title', ws.title, 'note', hl.note,
        'logged_by', hl.logged_by, 'created_at', hl.created_at
      ) order by hl.work_date desc, hl.start_time desc nulls last, hl.created_at desc), '[]'::jsonb)
      from hour_logs hl
      join donors d on d.id = hl.donor_id
      left join work_shifts ws on ws.id = hl.shift_id
    )
  );
end;
$$;

-- Admin entries skip the "must be signed up for the shift" and "times required" rules —
-- Inani backfilling someone's day may only know "about 6 hours".
create or replace function admin_save_hours(
  p_session_token uuid, p_id uuid, p_donor_id uuid, p_work_date date, p_start_time time, p_end_time time,
  p_hours numeric, p_item_id uuid, p_role_other text, p_shift_id uuid, p_note text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_role record; v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if not exists (select 1 from donors where id = p_donor_id) then raise exception 'donor_not_found'; end if;
  perform hours_check_values(p_work_date, p_hours);
  select * into v_role from hours_resolve_role(p_item_id, p_role_other, p_shift_id);

  if p_id is null then
    insert into hour_logs (donor_id, work_date, start_time, end_time, hours, item_id, role_label, shift_id, note, logged_by)
    values (p_donor_id, p_work_date, p_start_time, p_end_time, round(p_hours, 2), v_role.o_item_id, v_role.o_label,
            p_shift_id, nullif(trim(coalesce(p_note, '')), ''), 'admin')
    returning id into v_id;
  else
    update hour_logs set
      donor_id = p_donor_id, work_date = p_work_date, start_time = p_start_time, end_time = p_end_time,
      hours = round(p_hours, 2), item_id = v_role.o_item_id, role_label = v_role.o_label, shift_id = p_shift_id,
      note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'hours_not_found'; end if;
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
  delete from hour_logs where id = p_id;
end;
$$;

create or replace function admin_upsert_shift(
  p_session_token uuid, p_id uuid, p_title text, p_item_id uuid, p_shift_date date,
  p_start_time time, p_end_time time, p_location text, p_description text, p_show_on_homepage boolean
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  perform check_admin_session(p_session_token);
  if p_item_id is not null and not exists (select 1 from wishlist_items where id = p_item_id and category = 'volunteer') then
    raise exception 'invalid_role';
  end if;
  if v_title is null and p_item_id is not null then
    select name into v_title from wishlist_items where id = p_item_id;
  end if;
  if v_title is null then raise exception 'shift_title_required'; end if;
  if p_shift_date is null or p_start_time is null or p_end_time is null then raise exception 'shift_times_required'; end if;

  if p_id is null then
    insert into work_shifts (title, item_id, shift_date, start_time, end_time, location, description, show_on_homepage)
    values (v_title, p_item_id, p_shift_date, p_start_time, p_end_time,
            nullif(trim(coalesce(p_location, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
            coalesce(p_show_on_homepage, true))
    returning id into v_id;
  else
    update work_shifts set
      title = v_title, item_id = p_item_id, shift_date = p_shift_date, start_time = p_start_time, end_time = p_end_time,
      location = nullif(trim(coalesce(p_location, '')), ''), description = nullif(trim(coalesce(p_description, '')), ''),
      show_on_homepage = coalesce(p_show_on_homepage, show_on_homepage), updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'shift_not_found'; end if;
  end if;
  return v_id;
end;
$$;

-- Hours already logged against a deleted shift are kept (shift_id just goes null).
create or replace function admin_delete_shift(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  delete from work_shifts where id = p_id;
end;
$$;

create or replace function admin_set_shift_signup(p_session_token uuid, p_shift_id uuid, p_donor_id uuid, p_signed_up boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  if p_signed_up then
    insert into shift_signups (shift_id, donor_id) values (p_shift_id, p_donor_id) on conflict do nothing;
  else
    delete from shift_signups where shift_id = p_shift_id and donor_id = p_donor_id;
  end if;
end;
$$;

-- Placeholder for someone building who has no account yet. The login name and passcode
-- are random and never shown — the only way in is the claim link.
create or replace function admin_create_unclaimed_person(p_session_token uuid, p_playa_name text, p_email text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if p_playa_name is null or trim(p_playa_name) = '' then raise exception 'contact_name_required'; end if;
  insert into donors (chosen_name, passcode_hash, contact_name, email, claim_code)
  values (
    'unclaimed-' || encode(gen_random_bytes(4), 'hex'),
    crypt(encode(gen_random_bytes(16), 'hex'), gen_salt('bf')),
    trim(p_playa_name),
    trim(coalesce(p_email, '')),
    encode(gen_random_bytes(12), 'hex')
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function admin_update_unclaimed_person(p_session_token uuid, p_id uuid, p_playa_name text, p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update donors set
    contact_name = coalesce(nullif(trim(coalesce(p_playa_name, '')), ''), contact_name),
    email = trim(coalesce(p_email, '')),
    updated_at = now()
  where id = p_id and claim_code is not null;
  if not found then raise exception 'donor_not_found'; end if;
end;
$$;

-- ============ grants ============
-- Supabase's default privileges grant EXECUTE on new public functions to anon/authenticated,
-- so internal helpers have to be revoked explicitly.
revoke execute on function erebe_local_today() from public, anon, authenticated;
revoke execute on function hours_resolve_role(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function hours_check_values(date, numeric) from public, anon, authenticated;
revoke execute on function shift_json(work_shifts) from public, anon, authenticated;

grant execute on function get_upcoming_shifts() to anon, authenticated;
grant execute on function donor_get_hours_context(uuid) to anon, authenticated;
grant execute on function donor_save_hours(uuid, uuid, date, time, time, numeric, uuid, text, uuid, text) to anon, authenticated;
grant execute on function donor_delete_hours(uuid, uuid) to anon, authenticated;
grant execute on function donor_set_shift_signup(uuid, uuid, boolean) to anon, authenticated;
grant execute on function get_claim_info(text) to anon, authenticated;
grant execute on function claim_account(text, text, text, text, text) to anon, authenticated;
grant execute on function claim_into_account(uuid, text) to anon, authenticated;
grant execute on function admin_get_hours_dashboard(uuid) to anon, authenticated;
grant execute on function admin_save_hours(uuid, uuid, uuid, date, time, time, numeric, uuid, text, uuid, text) to anon, authenticated;
grant execute on function admin_delete_hours(uuid, uuid) to anon, authenticated;
grant execute on function admin_upsert_shift(uuid, uuid, text, uuid, date, time, time, text, text, boolean) to anon, authenticated;
grant execute on function admin_delete_shift(uuid, uuid) to anon, authenticated;
grant execute on function admin_set_shift_signup(uuid, uuid, uuid, boolean) to anon, authenticated;
grant execute on function admin_create_unclaimed_person(uuid, text, text) to anon, authenticated;
grant execute on function admin_update_unclaimed_person(uuid, uuid, text, text) to anon, authenticated;
