-- Feedback/issue-request box in Admin: submissions get logged here AND published as a
-- GitHub issue on the-erebe repo (via an Edge Function, since Postgres functions can't
-- make outbound HTTP calls) so Chipper gets a normal GitHub notification for free.

create table feedback_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  status text not null default 'pending' check (status in ('pending','created','failed')),
  github_issue_number integer,
  github_issue_url text,
  error_message text,
  created_at timestamptz not null default now()
);
alter table feedback_requests enable row level security;
-- no policies: written by the edge function (service role) and read via the
-- SECURITY DEFINER function below, same lockdown pattern as everything else here

-- Holds the GitHub token the edge function uses. There's no MCP tool available in this
-- environment for setting a real Supabase Edge Function secret, so this locked-down
-- table (RLS, no policies -> unreachable via the anon/authenticated API, only readable
-- by the edge function via its service-role key or by direct SQL) stands in for one.
create table integration_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table integration_secrets enable row level security;

create or replace function admin_get_feedback_requests(p_session_token uuid)
returns table(
  id uuid, title text, body text, status text,
  github_issue_number integer, github_issue_url text, error_message text, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return query select id, title, body, status, github_issue_number, github_issue_url, error_message, created_at
  from feedback_requests order by created_at desc;
end;
$$;

grant execute on function admin_get_feedback_requests(uuid) to anon, authenticated;
