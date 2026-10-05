create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- Daily ECB reference rates (via Frankfurter). EUR is the ECB base currency.
create table public.fx_rates (
  rate_date date primary key,
  eur_ron numeric(12, 6) not null check (eur_ron > 0),
  fetched_at timestamptz not null default now()
);
alter table public.fx_rates enable row level security;
revoke all on public.fx_rates from anon, authenticated;
grant select on public.fx_rates to authenticated;
create policy "Signed-in users can read exchange rates" on public.fx_rates
  for select to authenticated using (true);

-- Converts using the ECB rate published on p_on, or the closest earlier business day.
create or replace function public.convert_currency(p_amount double precision, p_from text, p_to text, p_on date)
returns double precision
language sql
stable
set search_path = ''
as $$
  select case
    when p_amount is null or p_from = p_to then p_amount
    else (
      select case when p_from = 'EUR' then p_amount * rate.eur_ron::double precision else p_amount / rate.eur_ron::double precision end
      from (
        select coalesce(
          (select r.eur_ron from public.fx_rates r where r.rate_date <= p_on order by r.rate_date desc limit 1),
          (select r.eur_ron from public.fx_rates r order by r.rate_date asc limit 1)
        ) as eur_ron
      ) rate
    )
  end
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.sync_fx_rates(p_from date default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_from date := coalesce(p_from, (select max(rate_date) from public.fx_rates), date '2020-01-01');
  v_response extensions.http_response;
  v_count integer;
begin
  -- Open-ended range: Frankfurter returns everything up to the latest published rate.
  select * into v_response from extensions.http_get(format('https://api.frankfurter.dev/v1/%s..?from=EUR&to=RON', v_from));
  if v_response.status <> 200 then
    raise exception 'ECB rate sync failed: HTTP % %', v_response.status, left(v_response.content, 200);
  end if;

  insert into public.fx_rates (rate_date, eur_ron)
  select day.key::date, (day.value ->> 'RON')::numeric
  from jsonb_each(v_response.content::jsonb -> 'rates') as day
  on conflict (rate_date) do update set eur_ron = excluded.eur_ron, fetched_at = now()
  where public.fx_rates.eur_ron is distinct from excluded.eur_ron;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.sync_fx_rates(date) from public;

-- ECB publishes around 16:00 CET on business days.
select cron.schedule('sync-ecb-fx-rates', '30 15 * * 1-5', 'select private.sync_fx_rates()');

-- Spend now converts every entry into the requested currency instead of filtering by it.
create or replace function public.daily_spend_for_month(p_currency text, p_month_start date, p_next_month_start date, p_car_id bigint default null)
returns table(date date, repair_spend double precision, trip_spend double precision)
language sql
stable
set search_path = ''
as $$
  with repair_spend as (
    select r.date, sum(public.convert_currency(r.price, r.currency, p_currency, r.date)) as total
    from public.repairs r
    where r.date >= p_month_start
      and r.date < p_next_month_start
      and r.status = 'done'
      and (p_car_id is null or r.car_id = p_car_id)
    group by r.date
  ),
  trip_spend as (
    select t.date, sum(public.convert_currency(t.price, t.currency, p_currency, t.date)) as total
    from public.trips t
    where t.date >= p_month_start
      and t.date < p_next_month_start
      and t.status = 'done'
      and (p_car_id is null or t.car_id = p_car_id)
    group by t.date
  )
  select
    coalesce(r.date, t.date) as date,
    coalesce(r.total, 0) as repair_spend,
    coalesce(t.total, 0) as trip_spend
  from repair_spend r
  full outer join trip_spend t on r.date = t.date
  order by 1 asc;
$$;