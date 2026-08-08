-- Bug fix: admin_get_feedback_requests threw "column reference id is ambiguous" on
-- every call, because RETURNS TABLE(id uuid, ...) creates a local PL/pgSQL variable
-- named `id` that collided with the unqualified `id` in the query's select list. This
-- broke the whole admin dashboard: loadDashboard() fetches all three tabs' data in
-- parallel, so this one failing call kicked admins straight back to the login screen
-- right after a successful login.

create or replace function admin_get_feedback_requests(p_session_token uuid)
returns table(
  id uuid, title text, body text, status text,
  github_issue_number integer, github_issue_url text, error_message text, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  return query
    select fr.id, fr.title, fr.body, fr.status, fr.github_issue_number, fr.github_issue_url, fr.error_message, fr.created_at
    from feedback_requests fr
    order by fr.created_at desc;
end;
$$;
