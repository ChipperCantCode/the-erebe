-- "Contact Inani" messages (portfolio.html) and content reports (gallery flag button).
--
-- Both are written by the submit-message Edge Function (public, rate-limited per IP, same
-- pattern as submit-feedback), which also opens a GitHub issue so Chipper gets notified.
-- The repo is PUBLIC, so the issue is an alert only ("new message from <first name>,
-- see Admin -> Inbox") -- the sender's email and message stay in these locked-down
-- tables and are only readable through the admin_* functions below.
--
-- Resend email delivery for contact messages is not set up yet; when it is, it slots into
-- the same Edge Function and these rows stay the system of record.

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  page text,
  submitter_ip text,
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  github_issue_number int,
  github_issue_url text,
  error_message text,
  created_at timestamptz not null default now()
);
create index on public.contact_messages (submitter_ip, created_at);

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  gallery_photo_id uuid references public.gallery_photos(id) on delete set null,
  about text not null check (about in ('photo', 'caption')),
  reason text not null check (reason in ('inappropriate', 'me_in_photo', 'my_photo_no_permission', 'spam', 'other')),
  details text,
  reporter_contact text,
  -- what the photo looked like when reported, kept even if the photo is later deleted
  photo_snapshot jsonb,
  reporter_ip text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  admin_note text,
  auto_hidden boolean not null default false,
  github_issue_number int,
  github_issue_url text,
  error_message text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.content_reports (gallery_photo_id, status);
create index on public.content_reports (reporter_ip, created_at);

alter table public.contact_messages enable row level security;
alter table public.content_reports enable row level security;
revoke all on public.contact_messages, public.content_reports from anon, authenticated;

create or replace function public.admin_get_inbox(p_session_token uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return json_build_object(
    'contacts', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'email', c.email, 'message', c.message, 'page', c.page,
        'status', c.status, 'github_issue_url', c.github_issue_url, 'github_issue_number', c.github_issue_number,
        'created_at', c.created_at
      ) order by c.created_at desc)
      from contact_messages c
    ), '[]'::json),
    'reports', coalesce((
      select json_agg(json_build_object(
        'id', r.id, 'gallery_photo_id', r.gallery_photo_id, 'about', r.about, 'reason', r.reason,
        'details', r.details, 'reporter_contact', r.reporter_contact, 'status', r.status,
        'admin_note', r.admin_note, 'auto_hidden', r.auto_hidden,
        'github_issue_url', r.github_issue_url, 'github_issue_number', r.github_issue_number,
        'created_at', r.created_at, 'resolved_at', r.resolved_at,
        'photo_snapshot', r.photo_snapshot,
        'photo', (select json_build_object(
            'id', ph.id, 'display_path', ph.display_path, 'storage_path', ph.storage_path,
            'caption', ph.caption, 'photographer', ph.photographer, 'status', ph.status,
            'section_title', (select s.title from gallery_sections s where s.id = ph.section_id))
          from gallery_photos ph where ph.id = r.gallery_photo_id)
      ) order by (r.status = 'open') desc, r.created_at desc)
      from content_reports r
    ), '[]'::json)
  );
end;
$$;
grant execute on function public.admin_get_inbox(uuid) to anon, authenticated;

create or replace function public.admin_set_contact_status(p_session_token uuid, p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  if p_status not in ('new', 'read', 'archived') then raise exception 'bad_status'; end if;
  update contact_messages set status = p_status where id = p_id;
end;
$$;
grant execute on function public.admin_set_contact_status(uuid, uuid, text) to anon, authenticated;

create or replace function public.admin_resolve_report(p_session_token uuid, p_id uuid, p_status text, p_admin_note text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  if p_status not in ('open', 'resolved', 'dismissed') then raise exception 'bad_status'; end if;
  update content_reports set
    status = p_status,
    admin_note = coalesce(nullif(trim(coalesce(p_admin_note, '')), ''), admin_note),
    resolved_at = case when p_status = 'open' then null else now() end
  where id = p_id;
end;
$$;
grant execute on function public.admin_resolve_report(uuid, uuid, text, text) to anon, authenticated;
