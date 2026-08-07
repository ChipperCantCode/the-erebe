-- Add a 'donation' category (USD-denominated asks), separate from physical 'material'
-- items. Add crew_location to contributions, replacing the old plain yes/no
-- "on_build_crew" question for volunteer signups with which of the two build crews
-- (CoLab prefab shop vs. the event site) a person will help at — the frontend derives
-- on_build_crew from this automatically, so the column stays for compatibility but the
-- UI no longer asks it directly. Also thread item_unit through the read RPCs so the
-- frontend can format $/% correctly.

alter table wishlist_items drop constraint wishlist_items_category_check;
alter table wishlist_items add constraint wishlist_items_category_check check (category in ('volunteer','material','donation'));

alter table contributions add column crew_location text check (crew_location in ('colab','event_site','both','remote'));

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
      item_id, donor_id, quantity, quantity_note, on_build_crew, crew_location,
      arrival_date, departure_date, loan_or_donated,
      pickup_method, pickup_method_other, pickup_timing, pickup_timing_other,
      pickup_location, care_instructions
    ) values (
      (v_item->>'item_id')::uuid,
      v_donor_id,
      (v_item->>'quantity')::numeric,
      nullif(v_item->>'quantity_note',''),
      (nullif(v_item->>'on_build_crew',''))::boolean,
      nullif(v_item->>'crew_location',''),
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

drop function get_my_contributions(uuid);

create function get_my_contributions(p_session_token uuid)
returns table (
  id uuid, item_id uuid, item_name text, item_category text, item_unit text, quantity numeric, quantity_note text,
  on_build_crew boolean, crew_location text, arrival_date date, departure_date date, loan_or_donated text,
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
      c.id, c.item_id, wi.name, wi.category, wi.unit, c.quantity, c.quantity_note, c.on_build_crew, c.crew_location,
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

grant execute on function get_my_contributions(uuid) to anon, authenticated;

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
            'id', c.id, 'item_id', c.item_id, 'item_name', wi.name, 'item_category', wi.category, 'item_unit', wi.unit,
            'quantity', c.quantity, 'quantity_note', c.quantity_note, 'on_build_crew', c.on_build_crew,
            'crew_location', c.crew_location,
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
        'admin_note', cr.admin_note, 'item_name', wi.name, 'item_unit', wi.unit, 'donor_chosen_name', d.chosen_name,
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

drop function admin_set_contribution(uuid,uuid,numeric,text,boolean,date,date,text,text,text,text,text,text,text);

create function admin_set_contribution(
  p_session_token uuid, p_id uuid, p_quantity numeric, p_status text,
  p_on_build_crew boolean, p_crew_location text, p_arrival_date date, p_departure_date date,
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
    on_build_crew = p_on_build_crew, crew_location = p_crew_location,
    arrival_date = p_arrival_date, departure_date = p_departure_date,
    loan_or_donated = p_loan_or_donated, pickup_method = p_pickup_method, pickup_method_other = p_pickup_method_other,
    pickup_timing = p_pickup_timing, pickup_timing_other = p_pickup_timing_other,
    pickup_location = p_pickup_location, care_instructions = p_care_instructions, updated_at = now()
  where id = p_id;
end;
$$;

grant execute on function admin_set_contribution(uuid,uuid,numeric,text,boolean,text,date,date,text,text,text,text,text,text,text) to anon, authenticated;
