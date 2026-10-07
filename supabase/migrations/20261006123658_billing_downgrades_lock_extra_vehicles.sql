-- Downgrades now take effect at the end of the paid period; remember which plan is coming.
alter table public.subscriptions add column scheduled_plan_id text references public.plans (id);
create index subscriptions_scheduled_plan_id_idx on public.subscriptions (scheduled_plan_id);

-- Vehicles above the plan's limit become read-only. Only the database sets this flag.
alter table public.cars add column locked boolean not null default false;
create index cars_user_locked_idx on public.cars (user_id, locked);
revoke update on public.cars from authenticated;
grant update (brand, model, year, description, mileage_km, photo_path) on public.cars to authenticated;

-- Keeps exactly `limit` vehicles active: currently active ones first (the user's choice), then the oldest.
create or replace function private.apply_vehicle_limit(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  select p.vehicle_limit into v_limit from public.plans p where p.id = private.effective_plan(p_user);
  update public.cars c
  set locked = ranked.rn > coalesce(v_limit, 2147483647)
  from (
    select id, row_number() over (order by locked asc, created_at asc, id asc) as rn
    from public.cars where user_id = p_user
  ) ranked
  where c.id = ranked.id and c.locked is distinct from (ranked.rn > coalesce(v_limit, 2147483647));
end;
$$;

create or replace function private.apply_vehicle_limit_from_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_vehicle_limit(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
create trigger subscriptions_apply_vehicle_limit
  after insert or update or delete on public.subscriptions
  for each row execute function private.apply_vehicle_limit_from_subscription();

-- Deleting a vehicle frees a slot; the oldest read-only vehicle takes it.
create trigger cars_apply_vehicle_limit_after_delete
  after delete on public.cars
  for each row execute function private.apply_vehicle_limit_from_subscription();

-- Read-only means no edits to the vehicle and no new or changed repairs, trips or documents.
-- Deletes stay allowed. Checks apply to API users only; internal functions run as the owner.
create or replace function private.block_locked_vehicle_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.locked and current_user in ('authenticated', 'anon') then
    raise exception 'vehicle_locked' using errcode = 'P0001', hint = 'Upgrade or choose this vehicle as active.';
  end if;
  return new;
end;
$$;
create trigger cars_block_locked_update
  before update on public.cars
  for each row execute function private.block_locked_vehicle_update();

create or replace function private.block_locked_vehicle_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.cars c where c.locked and c.id in (new.car_id, case when tg_op = 'UPDATE' then old.car_id end))
     and session_user <> 'postgres' and (select auth.role()) is distinct from 'service_role' then
    raise exception 'vehicle_locked' using errcode = 'P0001', hint = 'Upgrade or choose this vehicle as active.';
  end if;
  return new;
end;
$$;
create trigger repairs_block_locked_vehicle before insert or update on public.repairs
  for each row execute function private.block_locked_vehicle_children();
create trigger trips_block_locked_vehicle before insert or update on public.trips
  for each row execute function private.block_locked_vehicle_children();
create trigger compliance_records_block_locked_vehicle before insert or update on public.compliance_records
  for each row execute function private.block_locked_vehicle_children();

revoke all on all functions in schema private from public, anon, authenticated;

-- Lets the user pick which vehicles stay active (up to the plan's limit); the rest become read-only.
create or replace function public.set_active_vehicles(p_car_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select p.vehicle_limit into v_limit from public.plans p where p.id = private.effective_plan(v_user);
  if v_limit is not null and coalesce(cardinality(p_car_ids), 0) > v_limit then
    raise exception 'too_many_active_vehicles' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_car_ids) as chosen(id)
             where not exists (select 1 from public.cars c where c.id = chosen.id and c.user_id = v_user)) then
    raise exception 'unknown_vehicle' using errcode = 'P0001';
  end if;
  update public.cars set locked = not (id = any (p_car_ids)) where user_id = v_user;
  -- Fill any remaining free slots with the oldest read-only vehicles.
  perform private.apply_vehicle_limit(v_user);
end;
$$;
revoke all on function public.set_active_vehicles(bigint[]) from public, anon;
grant execute on function public.set_active_vehicles(bigint[]) to authenticated;

-- Overview now also reports read-only vehicles and any scheduled plan change.
drop function public.billing_overview();
create function public.billing_overview()
returns table (
  plan_id text,
  vehicle_limit integer,
  included_vehicles integer,
  vehicles_used integer,
  locked_vehicles integer,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  scheduled_plan_id text
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.vehicle_limit, p.included_vehicles,
    (select count(*)::integer from public.cars c where c.user_id = (select auth.uid())),
    (select count(*)::integer from public.cars c where c.user_id = (select auth.uid()) and c.locked),
    s.status, s.current_period_end, coalesce(s.cancel_at_period_end, false), s.scheduled_plan_id
  from public.plans p
  left join public.subscriptions s on s.user_id = (select auth.uid()) and s.plan_id = p.id
  where p.id = coalesce(
    (select s2.plan_id from public.subscriptions s2
      where s2.user_id = (select auth.uid()) and s2.status in ('active', 'trialing', 'past_due')),
    'free')
$$;
revoke all on function public.billing_overview() from public, anon;
grant execute on function public.billing_overview() to authenticated;

-- Bring existing accounts in line with their current plan.
select private.apply_vehicle_limit(u.user_id) from (select distinct user_id from public.cars) u;
