-- No self-service password reset by design (no email-sending infra, and the whole
-- point of chosen-name+passcode was to avoid a real auth system) — so the fallback is
-- admin-mediated: generate a fresh passcode and let the admin relay it to the donor
-- directly (text, email, in person).
create or replace function admin_reset_donor_passcode(p_session_token uuid, p_donor_id uuid)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare v_new_passcode text;
begin
  perform check_admin_session(p_session_token);
  v_new_passcode := substr(md5(random()::text), 1, 8);
  update donors set passcode_hash = crypt(v_new_passcode, gen_salt('bf')), updated_at = now() where id = p_donor_id;
  if not found then
    raise exception 'donor_not_found';
  end if;
  return v_new_passcode;
end;
$$;

grant execute on function admin_reset_donor_passcode(uuid,uuid) to anon, authenticated;
