-- Community photo gallery (gallery.html).
--
-- * Admins create/rename/reorder/delete sections and move photos between them.
-- * Anyone can upload into any section (via the gallery-photos Edge Function -- it does
--   the file storage, rate-limits per IP, and requires a photographer credit plus a
--   rights/consent confirmation). Uploads go live immediately; a report button plus
--   auto-hide-after-3-reports (see 020) is the safety net.
-- * If the uploader is logged in with their My List (donor) account, the photo is tied to
--   them and they can later edit its caption or remove it. Anonymous uploads can't be
--   edited afterwards ("once it's there, it's there") -- only an admin can change them.
-- * Uploader IP and donor id are never returned by any public function.

create table public.gallery_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.gallery_sections(id) on delete restrict,
  storage_path text not null,           -- ~2000px "full" copy
  display_path text not null,           -- ~1200px copy used in the grid
  width int,
  height int,
  fit text not null default 'normal' check (fit in ('normal', 'enlarge', 'pad')),
  caption text,
  photographer text not null,           -- who took it (credit is required)
  is_own_photo boolean not null default false,
  uploader_name text,                   -- optional display name of whoever uploaded it
  donor_id uuid references public.donors(id) on delete set null,
  uploader_ip text,
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  hidden_reason text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.gallery_photos (section_id, sort_order);
create index on public.gallery_photos (donor_id);
create index on public.gallery_photos (uploader_ip, created_at);

alter table public.gallery_sections enable row level security;
alter table public.gallery_photos enable row level security;
revoke all on public.gallery_sections, public.gallery_photos from anon, authenticated;

-- donor id for a token, or null if missing/expired (never raises -- public pages call this)
create or replace function public.try_donor_session(p_token uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select donor_id from donor_sessions where token = p_token and expires_at > now();
$$;
revoke all on function public.try_donor_session(uuid) from public, anon, authenticated;

create or replace function public.gallery_photo_json(ph public.gallery_photos, p_donor_id uuid)
returns json
language sql stable set search_path = public
as $$
  select json_build_object(
    'id', ph.id, 'section_id', ph.section_id,
    'storage_path', ph.storage_path, 'display_path', ph.display_path,
    'width', ph.width, 'height', ph.height, 'fit', ph.fit,
    'caption', ph.caption, 'photographer', ph.photographer, 'is_own_photo', ph.is_own_photo,
    'uploader_name', ph.uploader_name, 'created_at', ph.created_at, 'sort_order', ph.sort_order,
    'mine', (p_donor_id is not null and ph.donor_id = p_donor_id)
  );
$$;
revoke all on function public.gallery_photo_json(public.gallery_photos, uuid) from public, anon, authenticated;

-- Public read. Pass a donor session token (or null) to get "mine": true on your own uploads.
create or replace function public.get_gallery(p_donor_token uuid default null)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare v_donor uuid := try_donor_session(p_donor_token);
begin
  return json_build_object(
    'signed_in', v_donor is not null,
    'sections', coalesce((
      select json_agg(json_build_object(
        'id', s.id, 'title', s.title, 'description', s.description, 'sort_order', s.sort_order,
        'photos', coalesce((
          select json_agg(gallery_photo_json(ph, v_donor) order by ph.sort_order, ph.created_at)
          from gallery_photos ph where ph.section_id = s.id and ph.status = 'visible'
        ), '[]'::json)
      ) order by s.sort_order, s.created_at)
      from gallery_sections s
    ), '[]'::json)
  );
end;
$$;
grant execute on function public.get_gallery(uuid) to anon, authenticated;

-- ---------- logged-in uploader: edit own captions ----------
create or replace function public.donor_update_gallery_caption(p_session_token uuid, p_photo_id uuid, p_caption text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_donor uuid;
begin
  v_donor := check_donor_session(p_session_token);
  update gallery_photos set caption = nullif(trim(coalesce(p_caption, '')), ''), updated_at = now()
  where id = p_photo_id and donor_id = v_donor;
  if not found then raise exception 'not_your_photo'; end if;
end;
$$;
grant execute on function public.donor_update_gallery_caption(uuid, uuid, text) to anon, authenticated;
-- (Removing a photo also deletes the stored file, so that goes through the gallery-photos Edge Function.)

-- ---------- admin ----------
create or replace function public.admin_get_gallery(p_session_token uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return json_build_object(
    'signed_in', false,
    'sections', coalesce((
      select json_agg(json_build_object(
        'id', s.id, 'title', s.title, 'description', s.description, 'sort_order', s.sort_order,
        'photos', coalesce((
          select json_agg(
            (gallery_photo_json(ph, null)::jsonb || jsonb_build_object(
              'status', ph.status, 'hidden_reason', ph.hidden_reason,
              'open_reports', (select count(*) from content_reports r where r.gallery_photo_id = ph.id and r.status = 'open')
            )) order by ph.sort_order, ph.created_at)
          from gallery_photos ph where ph.section_id = s.id
        ), '[]'::json)
      ) order by s.sort_order, s.created_at)
      from gallery_sections s
    ), '[]'::json)
  );
end;
$$;
-- (content_reports is created in 020; plpgsql only resolves table names when the function runs)
grant execute on function public.admin_get_gallery(uuid) to anon, authenticated;

create or replace function public.admin_upsert_gallery_section(p_session_token uuid, p_id uuid, p_title text, p_description text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform check_admin_session(p_session_token);
  if trim(coalesce(p_title, '')) = '' then raise exception 'title_required'; end if;
  if p_id is null then
    insert into gallery_sections (title, description, sort_order)
    values (trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
            coalesce((select max(sort_order) from gallery_sections), 0) + 10)
    returning id into v_id;
  else
    update gallery_sections set title = trim(p_title), description = nullif(trim(coalesce(p_description, '')), '')
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'section_not_found'; end if;
  end if;
  return v_id;
end;
$$;
grant execute on function public.admin_upsert_gallery_section(uuid, uuid, text, text) to anon, authenticated;

create or replace function public.admin_reorder_gallery_sections(p_session_token uuid, p_section_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update gallery_sections s set sort_order = o.ord * 10
  from unnest(p_section_ids) with ordinality as o(id, ord)
  where s.id = o.id;
end;
$$;
grant execute on function public.admin_reorder_gallery_sections(uuid, uuid[]) to anon, authenticated;

-- Deleting a section (only allowed when it's empty) is handled by the gallery-photos
-- Edge Function rather than an RPC, alongside photo deletion, which has to go through
-- the Storage API anyway.

-- Move a photo to a section (goes to the end of that section).
create or replace function public.admin_move_gallery_photo(p_session_token uuid, p_photo_id uuid, p_section_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  if not exists (select 1 from gallery_sections where id = p_section_id) then raise exception 'section_not_found'; end if;
  update gallery_photos set
    section_id = p_section_id,
    sort_order = coalesce((select max(sort_order) from gallery_photos where section_id = p_section_id), 0) + 10,
    updated_at = now()
  where id = p_photo_id;
end;
$$;
grant execute on function public.admin_move_gallery_photo(uuid, uuid, uuid) to anon, authenticated;

create or replace function public.admin_reorder_gallery_photos(p_session_token uuid, p_section_id uuid, p_photo_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update gallery_photos ph set sort_order = o.ord * 10
  from unnest(p_photo_ids) with ordinality as o(id, ord)
  where ph.id = o.id and ph.section_id = p_section_id;
end;
$$;
grant execute on function public.admin_reorder_gallery_photos(uuid, uuid, uuid[]) to anon, authenticated;

create or replace function public.admin_update_gallery_photo(p_session_token uuid, p_photo_id uuid, p_caption text, p_photographer text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  update gallery_photos set
    caption = nullif(trim(coalesce(p_caption, '')), ''),
    photographer = coalesce(nullif(trim(coalesce(p_photographer, '')), ''), photographer),
    updated_at = now()
  where id = p_photo_id;
end;
$$;
grant execute on function public.admin_update_gallery_photo(uuid, uuid, text, text) to anon, authenticated;

create or replace function public.admin_set_gallery_photo_status(p_session_token uuid, p_photo_id uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  if p_status not in ('visible', 'hidden') then raise exception 'bad_status'; end if;
  update gallery_photos set
    status = p_status,
    hidden_reason = case when p_status = 'hidden' then nullif(trim(coalesce(p_reason, '')), '') else null end,
    updated_at = now()
  where id = p_photo_id;
end;
$$;
grant execute on function public.admin_set_gallery_photo_status(uuid, uuid, text, text) to anon, authenticated;

-- ---------- storage bucket + a starter section ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into public.gallery_sections (title, description, sort_order)
select 'Building the Erebe', 'Build days, crew, and works in progress.', 10
where not exists (select 1 from public.gallery_sections);
