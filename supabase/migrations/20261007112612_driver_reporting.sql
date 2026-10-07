-- Optional "driven by" on trips; when empty, the trip belongs to whoever had the car assigned that day.
alter table public.trips add column driver_id bigint references public.drivers (id) on delete set null;
create index trips_driver_id_idx on public.trips (driver_id) where driver_id is not null;
create index driver_assignments_car_period_idx on public.driver_assignments (car_id, starts_on desc, ends_on);

create or replace function private.validate_trip_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.driver_id is not null and not exists (
    select 1 from public.drivers d where d.id = new.driver_id and d.user_id = new.user_id
  ) then
    raise exception 'Driver not found';
  end if;
  return new;
end;
$$;
create trigger trips_validate_driver
  before insert or update of driver_id, user_id on public.trips
  for each row execute function private.validate_trip_driver();
revoke all on all functions in schema private from public, anon, authenticated;

-- Who had a vehicle on a given day (latest overlapping assignment wins). Runs as the caller (RLS applies).
create or replace function public.driver_for_car_on(p_car_id bigint, p_date date)
returns bigint
language sql
stable
set search_path = ''
as $$
  select a.driver_id
  from public.driver_assignments a
  where a.car_id = p_car_id and a.starts_on <= p_date and (a.ends_on is null or a.ends_on >= p_date)
  order by a.starts_on desc, a.id desc
  limit 1
$$;
revoke all on function public.driver_for_car_on(bigint, date) from public, anon;
grant execute on function public.driver_for_car_on(bigint, date) to authenticated;

-- Per-driver report for a period, amounts converted into p_currency (ECB rates, like daily_spend_for_month).
-- Settlements are counted by week_start; repairs by the assignment active on the repair date.
-- outstanding_all_time is the open balance across every week, not just the period.
create or replace function public.driver_report(p_from date, p_to date, p_currency text)
returns table (
  driver_id bigint,
  full_name text,
  active boolean,
  vehicles text,
  trips integer,
  distance double precision,
  fuel_used double precision,
  fuel_cost double precision,
  repairs integer,
  repair_cost double precision,
  weeks integer,
  gross_earnings double precision,
  vehicle_rent double precision,
  fleet_commission double precision,
  fines double precision,
  payout double precision,
  settled double precision,
  outstanding double precision,
  outstanding_all_time double precision
)
language sql
stable
set search_path = ''
as $$
  with trip_rows as (
    select coalesce(t.driver_id, public.driver_for_car_on(t.car_id, t.date)) as driver_id,
      t.distance, t.fuel_used, public.convert_currency(t.price, t.currency, p_currency, t.date) as cost
    from public.trips t
    where t.status = 'done' and t.date between p_from and p_to
  ),
  trip_totals as (
    select driver_id, count(*)::integer as trips, sum(distance) as distance, sum(fuel_used) as fuel_used, coalesce(sum(cost), 0) as fuel_cost
    from trip_rows where driver_id is not null group by driver_id
  ),
  repair_totals as (
    select x.driver_id, count(*)::integer as repairs, sum(x.cost) as repair_cost
    from (
      select public.driver_for_car_on(r.car_id, r.date) as driver_id, public.convert_currency(r.price, r.currency, p_currency, r.date) as cost
      from public.repairs r
      where r.status = 'done' and r.date between p_from and p_to
    ) x
    where x.driver_id is not null group by x.driver_id
  ),
  settlement_totals as (
    select s.driver_id, count(*)::integer as weeks,
      sum(public.convert_currency(s.gross_earnings, s.currency, p_currency, s.week_start)) as gross_earnings,
      sum(public.convert_currency(s.vehicle_rent, s.currency, p_currency, s.week_start)) as vehicle_rent,
      sum(public.convert_currency(s.fleet_commission, s.currency, p_currency, s.week_start)) as fleet_commission,
      sum(public.convert_currency(s.fines, s.currency, p_currency, s.week_start)) as fines,
      sum(public.convert_currency(s.net_amount, s.currency, p_currency, s.week_start)) as payout,
      sum(public.convert_currency(s.amount_settled, s.currency, p_currency, s.week_start)) as settled,
      sum(public.convert_currency(s.outstanding_amount, s.currency, p_currency, s.week_start)) as outstanding
    from public.weekly_settlements s
    where s.week_start between p_from and p_to
    group by s.driver_id
  ),
  open_totals as (
    select s.driver_id, sum(public.convert_currency(s.outstanding_amount, s.currency, p_currency, s.week_start)) as outstanding_all_time
    from public.weekly_settlements s group by s.driver_id
  ),
  vehicle_labels as (
    select a.driver_id, string_agg(distinct a.vehicle_label, ', ') as vehicles
    from public.driver_assignments a
    where a.starts_on <= p_to and (a.ends_on is null or a.ends_on >= p_from)
    group by a.driver_id
  )
  select d.id, d.full_name, d.active, v.vehicles,
    coalesce(tt.trips, 0), coalesce(tt.distance, 0), coalesce(tt.fuel_used, 0), coalesce(tt.fuel_cost, 0),
    coalesce(rt.repairs, 0), coalesce(rt.repair_cost, 0),
    coalesce(st.weeks, 0), coalesce(st.gross_earnings, 0), coalesce(st.vehicle_rent, 0), coalesce(st.fleet_commission, 0),
    coalesce(st.fines, 0), coalesce(st.payout, 0), coalesce(st.settled, 0), coalesce(st.outstanding, 0),
    coalesce(ot.outstanding_all_time, 0)
  from public.drivers d
  left join trip_totals tt on tt.driver_id = d.id
  left join repair_totals rt on rt.driver_id = d.id
  left join settlement_totals st on st.driver_id = d.id
  left join open_totals ot on ot.driver_id = d.id
  left join vehicle_labels v on v.driver_id = d.id
  order by d.active desc, d.full_name
$$;
revoke all on function public.driver_report(date, date, text) from public, anon;
grant execute on function public.driver_report(date, date, text) to authenticated;
