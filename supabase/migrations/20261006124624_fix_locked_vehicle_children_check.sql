-- Run as the caller (not security definer) so current_user identifies API users reliably,
-- matching the check used for the vehicle itself. Users can always read their own vehicles.
create or replace function private.block_locked_vehicle_children()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and exists (select 1 from public.cars c where c.locked and c.id in (new.car_id, case when tg_op = 'UPDATE' then old.car_id end)) then
    raise exception 'vehicle_locked' using errcode = 'P0001', hint = 'Upgrade or choose this vehicle as active.';
  end if;
  return new;
end;
$$;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.block_locked_vehicle_children() to authenticated;
