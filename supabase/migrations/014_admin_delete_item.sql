-- Admin panel could upsert wish list items but never delete them, so duplicates or
-- items added by mistake had no way to be removed short of a manual SQL delete.
create or replace function admin_delete_item(p_session_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform check_admin_session(p_session_token);
  if exists (select 1 from contributions where item_id = p_id) then
    raise exception 'item_has_contributions';
  end if;
  delete from wishlist_items where id = p_id;
end;
$$;

grant execute on function admin_delete_item(uuid, uuid) to anon, authenticated;
