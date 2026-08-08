-- Admin-editable homepage content: a hero tagline/subtagline/CTA-text (plain text,
-- short) plus a reorderable list of rich-text content sections. Everything visitors
-- see on the front page is now something Inani can edit himself from
-- Admin -> Homepage Copy, the same way he already edits the wish list.
--
-- The CTA pitch text lives in site_settings (not page_sections) on purpose: it sits
-- right next to the hardcoded "Participate ->" button in the template, and keeping it
-- a fixed single field means it can't accidentally get archived/deleted the way an
-- open-ended section could.
--
-- Security note: body_html is stored as-is (writes only happen through the
-- admin-passcode-gated RPCs below), but the actual XSS boundary is at render time —
-- shared.js's sanitizeRichText() runs a strict tag/attribute allowlist on it in the
-- browser before it's ever set via innerHTML on a page a regular visitor loads.

create table site_settings (
  id smallint primary key default 1 check (id = 1),
  hero_tagline text not null default 'A temple rising for YOUtopia 2026',
  hero_subtagline text not null default 'San Diego · Burning Man regional event',
  cta_text text not null default 'An afternoon, a truck, a box of screws, or a few dollars toward the sales tax on materials — there''s a place for it.',
  updated_at timestamptz not null default now()
);
insert into site_settings (id) values (1);

create table page_sections (
  id uuid primary key default gen_random_uuid(),
  heading text,
  body_html text not null default '',
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;
alter table page_sections enable row level security;
-- no policies: access only via the SECURITY DEFINER functions below

create or replace function get_homepage_content()
returns jsonb
language sql security definer set search_path = public
as $$
  select jsonb_build_object(
    'hero_tagline', (select hero_tagline from site_settings where id = 1),
    'hero_subtagline', (select hero_subtagline from site_settings where id = 1),
    'cta_text', (select cta_text from site_settings where id = 1),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'heading', heading, 'body_html', body_html) order by sort_order)
      from page_sections where archived = false
    ), '[]'::jsonb)
  );
$$;

create or replace function admin_get_homepage_content(p_session_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return jsonb_build_object(
    'hero_tagline', (select hero_tagline from site_settings where id = 1),
    'hero_subtagline', (select hero_subtagline from site_settings where id = 1),
    'cta_text', (select cta_text from site_settings where id = 1),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'heading', heading, 'body_html', body_html, 'sort_order', sort_order, 'archived', archived
      ) order by sort_order)
      from page_sections
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function admin_update_site_settings(p_session_token uuid, p_hero_tagline text, p_hero_subtagline text, p_cta_text text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update site_settings set
    hero_tagline = coalesce(nullif(p_hero_tagline,''), hero_tagline),
    hero_subtagline = coalesce(nullif(p_hero_subtagline,''), hero_subtagline),
    cta_text = coalesce(nullif(p_cta_text,''), cta_text),
    updated_at = now()
  where id = 1;
end;
$$;

create or replace function admin_upsert_page_section(
  p_session_token uuid, p_id uuid, p_heading text, p_body_html text, p_sort_order integer, p_archived boolean
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if p_id is null then
    insert into page_sections (heading, body_html, sort_order, archived)
    values (p_heading, coalesce(p_body_html,''), coalesce(p_sort_order,0), coalesce(p_archived,false))
    returning id into v_id;
  else
    update page_sections set
      heading = p_heading, body_html = coalesce(p_body_html,''),
      sort_order = coalesce(p_sort_order, sort_order), archived = coalesce(p_archived, archived),
      updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function admin_delete_page_section(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  delete from page_sections where id = p_id;
end;
$$;

grant execute on function get_homepage_content() to anon, authenticated;
grant execute on function admin_get_homepage_content(uuid) to anon, authenticated;
grant execute on function admin_update_site_settings(uuid,text,text,text) to anon, authenticated;
grant execute on function admin_upsert_page_section(uuid,uuid,text,text,integer,boolean) to anon, authenticated;
grant execute on function admin_delete_page_section(uuid,uuid) to anon, authenticated;

-- seed with the current landing page copy so Inani starts with real content, not a
-- blank page
insert into page_sections (heading, body_html, sort_order) values
('What is the Erebe?', '<p>The Erebe is a temporary, publicly-occupied temple — a dark, tapering sanctuary surrounded by jagged, crystalline spires, built to hold reflection, memory, and quiet communal ritual at YOUtopia 2026, a Burning Man regional event in the San Diego high desert.</p><p>Inside, a central chamber holds an altar, a stairway to an upper deck, memory alcoves, and concealed passages, lit by cutouts that let daylight — and later, firelight — filter through. Local artist <strong>Inani</strong> and a crew of builders are raising it by hand, from framing lumber, prefabricated spire segments, and whatever salvage and donated materials the community can offer.</p>', 10),
('Built by hand, built together', '<p>A field crew frames the temple itself, live at the event site. A separate crew prefabricates the surrounding spires nearby, then hauls them out for final assembly. Every principle Burning Man holds — participation, gifting, radical self-reliance, leave no trace — runs through how it''s being built, not just how it''s used once it''s standing.</p>', 20);
