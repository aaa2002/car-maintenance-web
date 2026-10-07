-- What each vehicle earned the fleet in a period, converted into p_currency (ECB rates):
-- rent + commission from weekly settlements (by week start), minus done repairs and the fines the fleet paid itself.
-- Fuel is left out because ride-sharing drivers pay for it. car_id is null for settlements without a vehicle.
create or replace function public.fleet_profit_by_car(p_from date, p_to date, p_currency text)
returns table (car_id bigint, income double precision, repair_cost double precision, fine_cost double precision)
language sql
stable
set search_path = ''
as $$
  with income as (
    select s.car_id, sum(public.convert_currency(s.vehicle_rent + s.fleet_commission, s.currency, p_currency, s.week_start)) as amount
    from public.weekly_settlements s
    where s.week_start between p_from and p_to
    group by s.car_id
  ),
  repairs as (
    select r.car_id, sum(public.convert_currency(r.price, r.currency, p_currency, r.date)) as amount
    from public.repairs r
    where r.status = 'done' and r.date between p_from and p_to
    group by r.car_id
  ),
  fines as (
    select f.car_id, sum(public.convert_currency(f.paid_amount, f.currency, p_currency, f.paid_on)) as amount
    from public.fines f
    where f.paid_on between p_from and p_to and (f.driver_id is null or not f.charge_driver)
    group by f.car_id
  ),
  cars as (
    select i.car_id from income i union select r.car_id from repairs r union select f.car_id from fines f
  )
  select c.car_id, coalesce(i.amount, 0), coalesce(r.amount, 0), coalesce(f.amount, 0)
  from cars c
  left join income i on i.car_id is not distinct from c.car_id
  left join repairs r on r.car_id is not distinct from c.car_id
  left join fines f on f.car_id is not distinct from c.car_id
$$;
revoke all on function public.fleet_profit_by_car(date, date, text) from public, anon;
grant execute on function public.fleet_profit_by_car(date, date, text) to authenticated;
