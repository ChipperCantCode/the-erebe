-- Inani livestreams build sessions on Facebook roughly monthly. This tracks them so the
-- homepage can show the latest one as a real embed and older ones as a dated archive,
-- editable by admins without a code change each time (same pattern as page_sections).
create table build_streams (
  id uuid primary key default gen_random_uuid(),
  video_url text not null,
  title text,
  stream_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table build_streams enable row level security;
-- No policies granted -- only reachable through the RPCs below, same as every other table.

create or replace function get_build_streams()
returns table (id uuid, video_url text, title text, stream_date date)
language sql security definer set search_path = public
as $$
  select id, video_url, title, stream_date
  from build_streams
  order by stream_date desc, created_at desc;
$$;

grant execute on function get_build_streams() to anon, authenticated;

create or replace function admin_upsert_build_stream(
  p_session_token uuid,
  p_id uuid,
  p_video_url text,
  p_title text,
  p_stream_date date
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_video_url text := trim(coalesce(p_video_url, ''));
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  perform check_admin_session(p_session_token);
  if v_video_url = '' then
    raise exception 'video_url_required';
  end if;

  if p_id is null then
    insert into build_streams (video_url, title, stream_date)
    values (v_video_url, v_title, coalesce(p_stream_date, current_date))
    returning id into v_id;
  else
    update build_streams
    set video_url = v_video_url,
        title = v_title,
        stream_date = coalesce(p_stream_date, stream_date)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'stream_not_found';
    end if;
  end if;

  return v_id;
end;
$$;

grant execute on function admin_upsert_build_stream(uuid, uuid, text, text, date) to anon, authenticated;

create or replace function admin_delete_build_stream(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  delete from build_streams where id = p_id;
end;
$$;

grant execute on function admin_delete_build_stream(uuid, uuid) to anon, authenticated;
