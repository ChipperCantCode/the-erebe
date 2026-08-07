-- Erebe wish list — RPC functions and grants.
-- Supabase installs pgcrypto into the `extensions` schema, so any function using
-- crypt()/gen_salt() needs `extensions` on its search_path alongside `public`.

-- ============ helpers ============
create or replace function check_donor_session(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  select donor_id into v_donor_id from donor_sessions where token = p_token and expires_at > now();
  if v_donor_id is null then
    raise exception 'invalid_session';
  end if;
  return v_donor_id;
end;
$$;

create or replace function check_admin_session(p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from admin_sessions where token = p_token and expires_at > now()) then
    raise exception 'invalid_admin_session';
  end if;
end;
$$;

-- ============ public read ============
create or replace function get_wishlist()
returns table (
  id uuid, category text, name text, description text, target_quantity numeric,
  unit text, sort_order integer, committed_quantity numeric, is_fulfilled boolean, thankyous jsonb
)
language sql security definer set search_path = public
as $$
  select
    wi.id, wi.category, wi.name, wi.description, wi.target_quantity, wi.unit, wi.sort_order,
    coalesce(sum(c.quantity) filter (where c.status = 'active'), 0) as committed_quantity,
    (wi.target_quantity is not null and coalesce(sum(c.quantity) filter (where c.status='active'),0) >= wi.target_quantity) as is_fulfilled,
    coalesce(
      jsonb_agg(
        jsonb_build_object('name', case when d.is_anonymous then 'Anonymous' else d.contact_name end, 'quantity', c.quantity)
        order by c.created_at
      ) filter (where c.status = 'active'),
      '[]'::jsonb
    ) as thankyous
  from wishlist_items wi
  left join contributions c on c.item_id = wi.id and c.status = 'active'
  left join donors d on d.id = c.donor_id
  where wi.archived = false
  group by wi.id
  order by wi.category, wi.sort_order, wi.name;
$$;

-- ============ donor auth ============
create or replace function donor_register(p_chosen_name text, p_passcode text, p_contact_name text, p_email text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_donor_id uuid; v_token uuid;
begin
  if p_chosen_name is null or trim(p_chosen_name) = '' then raise exception 'chosen_name_required'; end if;
  if p_passcode is null or length(p_passcode) < 3 then raise exception 'passcode_too_short'; end if;
  if p_contact_name is null or trim(p_contact_name) = '' then raise exception 'contact_name_required'; end if;
  if p_email is null or trim(p_email) = '' then raise exception 'email_required'; end if;
  if exists (select 1 from donors where chosen_name_lower = lower(trim(p_chosen_name))) then raise exception 'name_taken'; end if;

  insert into donors (chosen_name, passcode_hash, contact_name, email)
  values (trim(p_chosen_name), crypt(p_passcode, gen_salt('bf')), trim(p_contact_name), trim(p_email))
  returning id into v_donor_id;

  insert into donor_sessions (donor_id) values (v_donor_id) returning token into v_token;
  return v_token;
end;
$$;

create or replace function donor_login(p_chosen_name text, p_passcode text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_donor donors%rowtype; v_token uuid;
begin
  select * into v_donor from donors where chosen_name_lower = lower(trim(coalesce(p_chosen_name,'')));
  if not found then raise exception 'not_found'; end if;
  if v_donor.passcode_hash <> crypt(coalesce(p_passcode,''), v_donor.passcode_hash) then raise exception 'incorrect_passcode'; end if;
  insert into donor_sessions (donor_id) values (v_donor.id) returning token into v_token;
  return v_token;
end;
$$;

create or replace function admin_login(p_name text, p_passcode text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_token uuid;
begin
  if lower(trim(coalesce(p_name,''))) <> 'admin' or coalesce(p_passcode,'') <> '5555' then
    raise exception 'incorrect_credentials';
  end if;
  insert into admin_sessions default values returning token into v_token;
  return v_token;
end;
$$;

-- ============ donor self-service ============
create or replace function get_my_donor_info(p_session_token uuid)
returns table(chosen_name text, contact_name text, email text, is_anonymous boolean)
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  return query select d.chosen_name, d.contact_name, d.email, d.is_anonymous from donors d where d.id = v_donor_id;
end;
$$;

create or replace function set_donor_anonymous(p_session_token uuid, p_is_anonymous boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  update donors set is_anonymous = p_is_anonymous, updated_at = now() where id = v_donor_id;
end;
$$;

create or replace function update_donor_contact(p_session_token uuid, p_contact_name text, p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  update donors set
    contact_name = coalesce(nullif(trim(p_contact_name),''), contact_name),
    email = coalesce(nullif(trim(p_email),''), email),
    updated_at = now()
  where id = v_donor_id;
end;
$$;

create or replace function submit_contributions(p_session_token uuid, p_items jsonb)
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid; v_item jsonb; v_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items_must_be_array'; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into contributions (
      item_id, donor_id, quantity, quantity_note, on_build_crew,
      arrival_date, departure_date, loan_or_donated,
      pickup_method, pickup_method_other, pickup_timing, pickup_timing_other,
      pickup_location, care_instructions
    ) values (
      (v_item->>'item_id')::uuid,
      v_donor_id,
      (v_item->>'quantity')::numeric,
      nullif(v_item->>'quantity_note',''),
      (nullif(v_item->>'on_build_crew',''))::boolean,
      nullif(v_item->>'arrival_date','')::date,
      nullif(v_item->>'departure_date','')::date,
      nullif(v_item->>'loan_or_donated',''),
      nullif(v_item->>'pickup_method',''),
      nullif(v_item->>'pickup_method_other',''),
      nullif(v_item->>'pickup_timing',''),
      nullif(v_item->>'pickup_timing_other',''),
      nullif(v_item->>'pickup_location',''),
      nullif(v_item->>'care_instructions','')
    )
    returning id into v_id;
    return next v_id;
  end loop;
  return;
end;
$$;

create or replace function get_my_contributions(p_session_token uuid)
returns table (
  id uuid, item_id uuid, item_name text, item_category text, quantity numeric, quantity_note text,
  on_build_crew boolean, arrival_date date, departure_date date, loan_or_donated text,
  pickup_method text, pickup_method_other text, pickup_timing text, pickup_timing_other text,
  pickup_location text, care_instructions text, status text, created_at timestamptz, pending_change jsonb
)
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid;
begin
  v_donor_id := check_donor_session(p_session_token);
  return query
    select
      c.id, c.item_id, wi.name, wi.category, c.quantity, c.quantity_note, c.on_build_crew,
      c.arrival_date, c.departure_date, c.loan_or_donated, c.pickup_method, c.pickup_method_other,
      c.pickup_timing, c.pickup_timing_other, c.pickup_location, c.care_instructions,
      c.status, c.created_at,
      (select jsonb_build_object('id', cr.id, 'requested_quantity', cr.requested_quantity, 'reason', cr.reason, 'status', cr.status)
       from change_requests cr where cr.contribution_id = c.id and cr.status = 'pending' limit 1) as pending_change
    from contributions c
    join wishlist_items wi on wi.id = c.item_id
    where c.donor_id = v_donor_id
    order by c.created_at desc;
end;
$$;

create or replace function request_contribution_change(p_session_token uuid, p_contribution_id uuid, p_new_quantity numeric, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_donor_id uuid; v_req_id uuid; v_current numeric;
begin
  v_donor_id := check_donor_session(p_session_token);
  if p_reason is null or trim(p_reason) = '' then raise exception 'reason_required'; end if;

  select quantity into v_current from contributions where id = p_contribution_id and donor_id = v_donor_id and status = 'active';
  if v_current is null then raise exception 'contribution_not_found'; end if;
  if p_new_quantity is not null and (p_new_quantity <= 0 or p_new_quantity >= v_current) then
    raise exception 'new_quantity_must_be_smaller';
  end if;

  select id into v_req_id from change_requests where contribution_id = p_contribution_id and status = 'pending';
  if v_req_id is not null then
    update change_requests set requested_quantity = p_new_quantity, reason = p_reason, created_at = now() where id = v_req_id;
  else
    insert into change_requests (contribution_id, requested_quantity, reason)
    values (p_contribution_id, p_new_quantity, p_reason)
    returning id into v_req_id;
  end if;
  return v_req_id;
end;
$$;

-- ============ admin ============
create or replace function admin_get_dashboard(p_session_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return jsonb_build_object(
    'wishlist_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', wi.id, 'category', wi.category, 'name', wi.name, 'description', wi.description,
        'target_quantity', wi.target_quantity, 'unit', wi.unit, 'sort_order', wi.sort_order,
        'archived', wi.archived,
        'committed_quantity', coalesce((select sum(c.quantity) from contributions c where c.item_id = wi.id and c.status='active'),0)
      ) order by wi.category, wi.sort_order), '[]'::jsonb)
      from wishlist_items wi
    ),
    'donors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'chosen_name', d.chosen_name, 'contact_name', d.contact_name,
        'email', d.email, 'is_anonymous', d.is_anonymous, 'created_at', d.created_at,
        'contributions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id, 'item_id', c.item_id, 'item_name', wi.name, 'item_category', wi.category,
            'quantity', c.quantity, 'quantity_note', c.quantity_note, 'on_build_crew', c.on_build_crew,
            'arrival_date', c.arrival_date, 'departure_date', c.departure_date,
            'loan_or_donated', c.loan_or_donated, 'pickup_method', c.pickup_method,
            'pickup_method_other', c.pickup_method_other, 'pickup_timing', c.pickup_timing,
            'pickup_timing_other', c.pickup_timing_other, 'pickup_location', c.pickup_location,
            'care_instructions', c.care_instructions, 'status', c.status, 'created_at', c.created_at
          ) order by c.created_at desc), '[]'::jsonb)
          from contributions c join wishlist_items wi on wi.id = c.item_id
          where c.donor_id = d.id
        )
      ) order by d.created_at desc), '[]'::jsonb)
      from donors d
    ),
    'change_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cr.id, 'contribution_id', cr.contribution_id, 'requested_quantity', cr.requested_quantity,
        'reason', cr.reason, 'status', cr.status, 'created_at', cr.created_at, 'resolved_at', cr.resolved_at,
        'admin_note', cr.admin_note, 'item_name', wi.name, 'donor_chosen_name', d.chosen_name,
        'donor_contact_name', d.contact_name, 'current_quantity', c.quantity
      ) order by cr.created_at desc), '[]'::jsonb)
      from change_requests cr
      join contributions c on c.id = cr.contribution_id
      join wishlist_items wi on wi.id = c.item_id
      join donors d on d.id = c.donor_id
    )
  );
end;
$$;

create or replace function admin_upsert_item(
  p_session_token uuid, p_id uuid, p_category text, p_name text, p_description text,
  p_target_quantity numeric, p_unit text, p_sort_order integer, p_archived boolean
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if p_id is null then
    insert into wishlist_items (category, name, description, target_quantity, unit, sort_order, archived)
    values (p_category, p_name, p_description, p_target_quantity, p_unit, coalesce(p_sort_order,0), coalesce(p_archived,false))
    returning id into v_id;
  else
    update wishlist_items set
      category = coalesce(p_category, category), name = coalesce(p_name, name), description = p_description,
      target_quantity = p_target_quantity, unit = p_unit, sort_order = coalesce(p_sort_order, sort_order),
      archived = coalesce(p_archived, archived), updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function admin_set_contribution(
  p_session_token uuid, p_id uuid, p_quantity numeric, p_status text,
  p_on_build_crew boolean, p_arrival_date date, p_departure_date date,
  p_loan_or_donated text, p_pickup_method text, p_pickup_method_other text,
  p_pickup_timing text, p_pickup_timing_other text, p_pickup_location text, p_care_instructions text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update contributions set
    quantity = coalesce(p_quantity, quantity), status = coalesce(p_status, status),
    on_build_crew = p_on_build_crew, arrival_date = p_arrival_date, departure_date = p_departure_date,
    loan_or_donated = p_loan_or_donated, pickup_method = p_pickup_method, pickup_method_other = p_pickup_method_other,
    pickup_timing = p_pickup_timing, pickup_timing_other = p_pickup_timing_other,
    pickup_location = p_pickup_location, care_instructions = p_care_instructions, updated_at = now()
  where id = p_id;
end;
$$;

create or replace function admin_delete_contribution(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  delete from contributions where id = p_id;
end;
$$;

create or replace function admin_add_contribution(p_session_token uuid, p_donor_id uuid, p_item_id uuid, p_quantity numeric, p_quantity_note text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform check_admin_session(p_session_token);
  insert into contributions (item_id, donor_id, quantity, quantity_note)
  values (p_item_id, p_donor_id, p_quantity, nullif(p_quantity_note,''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function admin_create_donor(p_session_token uuid, p_chosen_name text, p_contact_name text, p_email text, p_passcode text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if exists (select 1 from donors where chosen_name_lower = lower(trim(p_chosen_name))) then raise exception 'name_taken'; end if;
  insert into donors (chosen_name, passcode_hash, contact_name, email)
  values (trim(p_chosen_name), crypt(coalesce(nullif(p_passcode,''), substr(md5(random()::text),1,8)), gen_salt('bf')), trim(p_contact_name), trim(p_email))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function admin_resolve_change_request(p_session_token uuid, p_request_id uuid, p_approve boolean, p_admin_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_req change_requests%rowtype;
begin
  perform check_admin_session(p_session_token);
  select * into v_req from change_requests where id = p_request_id and status = 'pending';
  if not found then raise exception 'request_not_found'; end if;

  if p_approve then
    if v_req.requested_quantity is null then
      update contributions set status = 'removed', updated_at = now() where id = v_req.contribution_id;
    else
      update contributions set quantity = v_req.requested_quantity, updated_at = now() where id = v_req.contribution_id;
    end if;
    update change_requests set status = 'approved', resolved_at = now(), admin_note = p_admin_note where id = p_request_id;
  else
    update change_requests set status = 'denied', resolved_at = now(), admin_note = p_admin_note where id = p_request_id;
  end if;
end;
$$;

-- ============ grants ============
revoke execute on all functions in schema public from public;

grant execute on function get_wishlist() to anon, authenticated;
grant execute on function donor_register(text,text,text,text) to anon, authenticated;
grant execute on function donor_login(text,text) to anon, authenticated;
grant execute on function admin_login(text,text) to anon, authenticated;
grant execute on function get_my_donor_info(uuid) to anon, authenticated;
grant execute on function set_donor_anonymous(uuid,boolean) to anon, authenticated;
grant execute on function update_donor_contact(uuid,text,text) to anon, authenticated;
grant execute on function submit_contributions(uuid,jsonb) to anon, authenticated;
grant execute on function get_my_contributions(uuid) to anon, authenticated;
grant execute on function request_contribution_change(uuid,uuid,numeric,text) to anon, authenticated;
grant execute on function admin_get_dashboard(uuid) to anon, authenticated;
grant execute on function admin_upsert_item(uuid,uuid,text,text,text,numeric,text,integer,boolean) to anon, authenticated;
grant execute on function admin_set_contribution(uuid,uuid,numeric,text,boolean,date,date,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function admin_delete_contribution(uuid,uuid) to anon, authenticated;
grant execute on function admin_add_contribution(uuid,uuid,uuid,numeric,text) to anon, authenticated;
grant execute on function admin_create_donor(uuid,text,text,text,text) to anon, authenticated;
grant execute on function admin_resolve_change_request(uuid,uuid,boolean,text) to anon, authenticated;
