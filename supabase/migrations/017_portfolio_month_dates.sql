-- ALREADY APPLIED to the live project (Supabase migration version 20261103104643,
-- name "portfolio_month_dates") from a Claude chat on 2026-11-03. Recorded here so the
-- repo matches the database. Do NOT re-run.
--
-- Switches project ordering from a bare year to a real month (occurred_on, always the
-- 1st of the month). get_portfolio() is replaced again in 018.

alter table public.portfolio_projects add column occurred_on date;
comment on column public.portfolio_projects.occurred_on is 'Month the project happened (store as the 1st of the month). Drives page order and the displayed "Mon YYYY" unless year_label overrides the display.';
comment on column public.portfolio_projects.year_label is 'Optional display override for multi-year projects, e.g. "2019, 2022". Leave null to show the month and year from occurred_on.';

create or replace function public.get_portfolio()
 returns json
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select json_build_object(
    'page', (select row_to_json(p) from (select intro_quote, intro_html, footer_html from portfolio_page where id = 1) p),
    'projects', coalesce((
      select json_agg(x order by x.occurred_on nulls last, x.sort_order)
      from (
        select pr.id, pr.slug, pr.title, pr.occurred_on,
          coalesce(pr.year_label, to_char(pr.occurred_on, 'Mon YYYY')) as date_label,
          pr.event, pr.role, pr.credit, pr.body_html, pr.sort_order,
          coalesce((select json_agg(json_build_object('id', ph.id, 'storage_path', ph.storage_path, 'caption', ph.caption) order by ph.sort_order)
                    from portfolio_photos ph where ph.project_id = pr.id), '[]'::json) as photos
        from portfolio_projects pr
        where not pr.archived
      ) x
    ), '[]'::json)
  );
$function$;

revoke all on function public.get_portfolio() from public;
grant execute on function public.get_portfolio() to anon, authenticated;

alter table public.portfolio_projects drop column sort_year;
