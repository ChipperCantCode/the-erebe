-- Portfolio intro quote + credits footer get the same treatment as the pieces:
-- inline editing on portfolio.html, an editable attribution line, and an edit history
-- (a trigger snapshots the page row before every change).

alter table public.portfolio_page add column if not exists intro_attribution text;
update public.portfolio_page set intro_attribution = 'Inani' where id = 1 and intro_attribution is null;

create table public.portfolio_page_versions (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,             -- the page row as it was BEFORE the change
  changed_at timestamptz not null default now()
);
create index on public.portfolio_page_versions (changed_at desc);
alter table public.portfolio_page_versions enable row level security;
revoke all on public.portfolio_page_versions from anon, authenticated;

create or replace function public.portfolio_page_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return new;   -- no-op save: nothing to record
  end if;
  insert into portfolio_page_versions (snapshot) values (to_jsonb(old));
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.portfolio_page_audit() from public, anon, authenticated;

create trigger portfolio_page_audit
before update on public.portfolio_page
for each row execute function public.portfolio_page_audit();

-- Public + admin reads now include the attribution.
create or replace function public.get_portfolio()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'page', (select row_to_json(p) from (select intro_quote, intro_attribution, intro_html, footer_html from portfolio_page where id = 1) p),
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

create or replace function public.admin_get_portfolio(p_session_token uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return json_build_object(
    'page', (select row_to_json(p) from (
      select intro_quote, intro_attribution, intro_html, footer_html, updated_at,
        (select count(*) from portfolio_page_versions) as version_count
      from portfolio_page where id = 1) p),
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

-- Saves quote + attribution + footer together. A new name rather than changing
-- admin_update_portfolio_page's arguments, so the API never sees two same-named functions
-- with overlapping arguments. (The old 3-argument function is unused and harmless.)
create or replace function public.admin_save_portfolio_page(
  p_session_token uuid,
  p_intro_quote text,
  p_intro_attribution text,
  p_footer_html text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  insert into portfolio_page (id, intro_quote, intro_attribution, footer_html, updated_at)
  values (1, nullif(trim(coalesce(p_intro_quote, '')), ''), nullif(trim(coalesce(p_intro_attribution, '')), ''),
          nullif(trim(coalesce(p_footer_html, '')), ''), now())
  on conflict (id) do update set
    intro_quote = excluded.intro_quote,
    intro_attribution = excluded.intro_attribution,
    footer_html = excluded.footer_html;
end;
$$;
grant execute on function public.admin_save_portfolio_page(uuid, text, text, text) to anon, authenticated;

create or replace function public.admin_get_portfolio_page_versions(p_session_token uuid)
returns table (id uuid, snapshot jsonb, changed_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return query
    select v.id, v.snapshot, v.changed_at
    from portfolio_page_versions v
    order by v.changed_at desc
    limit 100;
end;
$$;
grant execute on function public.admin_get_portfolio_page_versions(uuid) to anon, authenticated;
