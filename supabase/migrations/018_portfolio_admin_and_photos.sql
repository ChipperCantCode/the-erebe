-- Portfolio admin: inline editing on portfolio.html + the Admin -> Portfolio tab.
--
-- * Photo metadata: every photo is uploaded as two browser-resized JPEGs -- a "full" copy
--   (~2000px long edge, what the lightbox/download shows) and a lighter "display" copy
--   (~1200px) for the page itself. width/height let the page reserve space before images
--   load. fit: 'normal' | 'enlarge' (small image stretched to fill its frame) | 'pad'
--   (small image shown at its own size on a matte).
-- * Audit trail: a trigger snapshots the OLD row into portfolio_project_versions on every
--   update or delete, so nothing an admin does to a piece's text is ever truly lost.
-- * get_portfolio() now returns newest first (Chipper's call: most recent on top).
-- * Storage: public bucket "portfolio". No storage policies at all -- reads work because
--   the bucket is public; writes only happen through the portfolio-photos Edge Function,
--   which checks the admin session token and then uses the service role.

alter table public.portfolio_photos
  add column if not exists display_path text,
  add column if not exists width int,
  add column if not exists height int,
  add column if not exists fit text not null default 'normal' check (fit in ('normal', 'enlarge', 'pad'));

-- ---------- audit trail ----------
create table public.portfolio_project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,            -- no FK on purpose: snapshots survive the project being deleted
  action text not null check (action in ('update', 'delete')),
  snapshot jsonb not null,             -- the row as it was BEFORE the change (plus photos, on delete)
  changed_at timestamptz not null default now()
);
create index on public.portfolio_project_versions (project_id, changed_at desc);
alter table public.portfolio_project_versions enable row level security;
revoke all on public.portfolio_project_versions from anon, authenticated;

create or replace function public.portfolio_projects_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- skip no-op saves so the history only shows real changes
    if (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
      return new;
    end if;
    insert into portfolio_project_versions (project_id, action, snapshot)
    values (old.id, 'update', to_jsonb(old));
    new.updated_at := now();
    return new;
  else
    insert into portfolio_project_versions (project_id, action, snapshot)
    values (old.id, 'delete', to_jsonb(old) || jsonb_build_object(
      'photos', coalesce((select jsonb_agg(to_jsonb(ph) order by ph.sort_order) from portfolio_photos ph where ph.project_id = old.id), '[]'::jsonb)
    ));
    return old;
  end if;
end;
$$;

create trigger portfolio_projects_audit
before update or delete on public.portfolio_projects
for each row execute function public.portfolio_projects_audit();

-- ---------- public read ----------
create or replace function public.portfolio_photo_json(ph public.portfolio_photos)
returns json
language sql stable set search_path = public
as $$
  select json_build_object(
    'id', ph.id, 'storage_path', ph.storage_path, 'display_path', coalesce(ph.display_path, ph.storage_path),
    'caption', ph.caption, 'width', ph.width, 'height', ph.height, 'fit', ph.fit, 'sort_order', ph.sort_order
  );
$$;

create or replace function public.get_portfolio()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'page', (select row_to_json(p) from (select intro_quote, intro_html, footer_html from portfolio_page where id = 1) p),
    'projects', coalesce((
      select json_agg(x order by x.occurred_on desc nulls last, x.sort_order desc)
      from (
        select pr.id, pr.slug, pr.title, pr.occurred_on,
          coalesce(pr.year_label, to_char(pr.occurred_on, 'Mon YYYY')) as date_label,
          pr.event, pr.role, pr.credit, pr.body_html, pr.sort_order,
          coalesce((select json_agg(portfolio_photo_json(ph) order by ph.sort_order, ph.created_at)
                    from portfolio_photos ph where ph.project_id = pr.id), '[]'::json) as photos
        from portfolio_projects pr
        where not pr.archived
      ) x
    ), '[]'::json)
  );
$$;
revoke all on function public.get_portfolio() from public;
grant execute on function public.get_portfolio() to anon, authenticated;

-- ---------- admin read (includes archived pieces and the raw editable fields) ----------
create or replace function public.admin_get_portfolio(p_session_token uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return json_build_object(
    'page', (select row_to_json(p) from (select intro_quote, intro_html, footer_html from portfolio_page where id = 1) p),
    'projects', coalesce((
      select json_agg(x order by x.occurred_on desc nulls last, x.sort_order desc)
      from (
        select pr.id, pr.slug, pr.title, pr.occurred_on, pr.year_label,
          coalesce(pr.year_label, to_char(pr.occurred_on, 'Mon YYYY')) as date_label,
          pr.event, pr.role, pr.credit, pr.body_html, pr.sort_order, pr.archived, pr.updated_at,
          (select count(*) from portfolio_project_versions v where v.project_id = pr.id) as version_count,
          coalesce((select json_agg(portfolio_photo_json(ph) order by ph.sort_order, ph.created_at)
                    from portfolio_photos ph where ph.project_id = pr.id), '[]'::json) as photos
        from portfolio_projects pr
      ) x
    ), '[]'::json)
  );
end;
$$;
grant execute on function public.admin_get_portfolio(uuid) to anon, authenticated;

-- ---------- admin writes ----------
create or replace function public.portfolio_slugify(p_text text)
returns text
language sql immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.admin_create_portfolio_project(p_session_token uuid, p_title text, p_occurred_on date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_base text;
  v_slug text;
  v_n int := 1;
  v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if v_title = '' then raise exception 'title_required'; end if;
  v_base := nullif(portfolio_slugify(v_title), '');
  v_base := coalesce(v_base, 'piece');
  v_slug := v_base;
  while exists (select 1 from portfolio_projects where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  insert into portfolio_projects (slug, title, occurred_on, sort_order)
  values (v_slug, v_title, date_trunc('month', coalesce(p_occurred_on, current_date))::date,
          coalesce((select max(sort_order) from portfolio_projects), 0) + 10)
  returning id into v_id;
  return json_build_object('id', v_id, 'slug', v_slug);
end;
$$;
grant execute on function public.admin_create_portfolio_project(uuid, text, date) to anon, authenticated;

create or replace function public.admin_update_portfolio_project(
  p_session_token uuid,
  p_id uuid,
  p_slug text,
  p_title text,
  p_occurred_on date,
  p_year_label text,
  p_event text,
  p_role text,
  p_credit text,
  p_body_html text,
  p_sort_order int
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_slug text := portfolio_slugify(p_slug);
begin
  perform check_admin_session(p_session_token);
  if trim(coalesce(p_title, '')) = '' then raise exception 'title_required'; end if;
  if v_slug = '' then raise exception 'slug_required'; end if;
  if p_occurred_on is null then raise exception 'month_required'; end if;
  if exists (select 1 from portfolio_projects where slug = v_slug and id <> p_id) then
    raise exception 'slug_taken';
  end if;
  update portfolio_projects set
    slug = v_slug,
    title = trim(p_title),
    occurred_on = date_trunc('month', p_occurred_on)::date,   -- always the 1st of the month
    year_label = nullif(trim(coalesce(p_year_label, '')), ''),
    event = nullif(trim(coalesce(p_event, '')), ''),
    role = nullif(trim(coalesce(p_role, '')), ''),
    credit = nullif(trim(coalesce(p_credit, '')), ''),
    body_html = coalesce(p_body_html, ''),
    sort_order = coalesce(p_sort_order, sort_order)
  where id = p_id;
  if not found then raise exception 'project_not_found'; end if;
end;
$$;
grant execute on function public.admin_update_portfolio_project(uuid, uuid, text, text, date, text, text, text, text, text, int) to anon, authenticated;

create or replace function public.admin_set_portfolio_project_archived(p_session_token uuid, p_id uuid, p_archived boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update portfolio_projects set archived = coalesce(p_archived, false) where id = p_id;
  if not found then raise exception 'project_not_found'; end if;
end;
$$;
grant execute on function public.admin_set_portfolio_project_archived(uuid, uuid, boolean) to anon, authenticated;

create or replace function public.admin_update_portfolio_page(p_session_token uuid, p_intro_quote text, p_footer_html text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  insert into portfolio_page (id, intro_quote, footer_html, updated_at)
  values (1, nullif(trim(coalesce(p_intro_quote, '')), ''), nullif(trim(coalesce(p_footer_html, '')), ''), now())
  on conflict (id) do update set
    intro_quote = excluded.intro_quote,
    footer_html = excluded.footer_html,
    updated_at = now();
end;
$$;
grant execute on function public.admin_update_portfolio_page(uuid, text, text) to anon, authenticated;

-- Caption + fit edits for many photos at once (sent with a piece's Save button).
-- p_photos: [{"id": "...", "caption": "...", "fit": "normal"}, ...]
create or replace function public.admin_update_portfolio_photos(p_session_token uuid, p_photos jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare v jsonb;
begin
  perform check_admin_session(p_session_token);
  for v in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    update portfolio_photos set
      caption = nullif(trim(coalesce(v->>'caption', '')), ''),
      fit = case when v->>'fit' in ('normal', 'enlarge', 'pad') then v->>'fit' else fit end
    where id = (v->>'id')::uuid;
  end loop;
end;
$$;
grant execute on function public.admin_update_portfolio_photos(uuid, jsonb) to anon, authenticated;

create or replace function public.admin_reorder_portfolio_photos(p_session_token uuid, p_project_id uuid, p_photo_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update portfolio_photos ph set sort_order = o.ord * 10
  from unnest(p_photo_ids) with ordinality as o(id, ord)
  where ph.id = o.id and ph.project_id = p_project_id;
end;
$$;
grant execute on function public.admin_reorder_portfolio_photos(uuid, uuid, uuid[]) to anon, authenticated;

create or replace function public.admin_get_portfolio_versions(p_session_token uuid, p_project_id uuid)
returns table (id uuid, action text, snapshot jsonb, changed_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return query
    select v.id, v.action, v.snapshot, v.changed_at
    from portfolio_project_versions v
    where v.project_id = p_project_id
    order by v.changed_at desc
    limit 100;
end;
$$;
grant execute on function public.admin_get_portfolio_versions(uuid, uuid) to anon, authenticated;

-- ---------- storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- internal helpers: only ever called from inside the functions above
revoke all on function public.portfolio_photo_json(public.portfolio_photos) from public, anon, authenticated;
revoke all on function public.portfolio_slugify(text) from public, anon, authenticated;
revoke all on function public.portfolio_projects_audit() from public, anon, authenticated;
