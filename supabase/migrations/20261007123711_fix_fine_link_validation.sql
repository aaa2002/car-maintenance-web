-- Deleting a driver nulls fines.driver_id before the cascaded settlement delete clears settlement_id,
-- so a fine without a driver may briefly keep its settlement link.
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
  if new.settlement_id is not null and not exists (
    select 1 from public.weekly_settlements s
    where s.id = new.settlement_id and s.user_id = new.user_id and (new.driver_id is null or s.driver_id = new.driver_id)
  ) then
    raise exception 'Settlement not found';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_fine_links() from public, anon, authenticated;
