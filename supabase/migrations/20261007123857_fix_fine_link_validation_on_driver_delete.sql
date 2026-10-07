-- Deleting a driver cascades to their settlements and nulls fines.driver_id while the settlement link is
-- still set (it is cleared right after). Validate the link only when it changes or the fine moves to another driver.
create or replace function private.validate_fine_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.driver_id is not null and not exists (
    select 1 from public.drivers d where d.id = new.driver_id and d.user_id = new.user_id
  ) then
    raise exception 'Driver not found';
  end if;
  if new.settlement_id is not null
     and (tg_op = 'INSERT' or new.settlement_id is distinct from old.settlement_id or (new.driver_id is not null and new.driver_id is distinct from old.driver_id))
     and not exists (
       select 1 from public.weekly_settlements s
       where s.id = new.settlement_id and s.user_id = new.user_id and s.driver_id = new.driver_id
     ) then
    raise exception 'Settlement not found';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_fine_links() from public, anon, authenticated;
