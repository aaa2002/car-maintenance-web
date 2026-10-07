create extension if not exists pg_net;

-- Plans. vehicle_limit null = no hard limit (FLEET bills extra cars instead).
create table public.plans (
  id text primary key check (id in ('free', 'standard', 'pro', 'fleet')),
  name text not null,
  vehicle_limit integer check (vehicle_limit is null or vehicle_limit > 0),
  included_vehicles integer not null check (included_vehicles > 0),
  monthly_price_bani integer not null default 0 check (monthly_price_bani >= 0),
  extra_vehicle_price_bani integer not null default 0 check (extra_vehicle_price_bani >= 0),
  stripe_price_id text unique,
  sort_order integer not null
);
insert into public.plans (id, name, vehicle_limit, included_vehicles, monthly_price_bani, extra_vehicle_price_bani, sort_order) values
  ('free', 'Free', 3, 3, 0, 0, 1),
  ('standard', 'Standard', 10, 10, 4900, 0, 2),
  ('pro', 'PRO', 30, 30, 9900, 0, 3),
  ('fleet', 'FLEET', null, 60, 14900, 200, 4);
alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated;
create policy "Anyone can read plans" on public.plans for select to anon, authenticated using (true);

-- Stripe customer per user. Written only by Edge Functions (secret key).
create table public.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon, authenticated;
grant select on public.billing_customers to authenticated;
create policy "billing_customers_select_own" on public.billing_customers
  for select to authenticated using ((select auth.uid()) = user_id);

-- One subscription per user, mirrored from Stripe webhooks.
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null,
  stripe_subscription_id text not null unique,
  stripe_item_id text not null,
  quantity integer not null default 1,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create index subscriptions_plan_id_idx on public.subscriptions (plan_id);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Paid plans stay in force while active, trialing or past_due (grace while Stripe retries payment).
create or replace function private.effective_plan(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.plan_id from public.subscriptions s
      where s.user_id = p_user and s.status in ('active', 'trialing', 'past_due')),
    'free'
  )
$$;

-- Block adding a car beyond the plan's limit. Existing cars are never touched.
create or replace function private.enforce_vehicle_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  -- Serialise concurrent inserts for the same user so two requests cannot both pass the check.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  v_plan := private.effective_plan(new.user_id);
  select p.vehicle_limit into v_limit from public.plans p where p.id = v_plan;
  if v_limit is null then
    return new;
  end if;
  select count(*) into v_count from public.cars c where c.user_id = new.user_id;
  if v_count >= v_limit then
    raise exception 'vehicle_limit_reached'
      using errcode = 'P0001', detail = format('%s of %s vehicles on the %s plan', v_count, v_limit, v_plan), hint = v_plan;
  end if;
  return new;
end;
$$;
create trigger cars_enforce_vehicle_limit
  before insert on public.cars
  for each row execute function private.enforce_vehicle_limit();

-- FLEET bills per car: ask the billing-sync function to update the Stripe quantity after cars change.
-- The URL and token live in Vault (billing_sync_url, billing_sync_token); without them this is a no-op.
create or replace function private.request_billing_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_url text;
  v_token text;
begin
  if private.effective_plan(v_user) <> 'fleet' then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'billing_sync_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'billing_sync_token';
  if v_url is null or v_token is null then
    return null;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-billing-sync-token', v_token),
    body := jsonb_build_object('user_id', v_user)
  );
  return null;
end;
$$;
create trigger cars_request_billing_sync
  after insert or delete on public.cars
  for each row execute function private.request_billing_sync();

revoke all on all functions in schema private from public, anon, authenticated;

-- Lets billing-sync (secret key / service_role only) check the token pg_net sends.
create or replace function public.billing_sync_token()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'billing_sync_token'
$$;
revoke all on function public.billing_sync_token() from public, anon, authenticated;
grant execute on function public.billing_sync_token() to service_role;

-- What the app shows in Settings: plan, limit and current usage for the signed-in user.
create or replace function public.billing_overview()
returns table (
  plan_id text,
  vehicle_limit integer,
  included_vehicles integer,
  vehicles_used integer,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.vehicle_limit, p.included_vehicles,
    (select count(*)::integer from public.cars c where c.user_id = (select auth.uid())),
    s.status, s.current_period_end, coalesce(s.cancel_at_period_end, false)
  from public.plans p
  left join public.subscriptions s on s.user_id = (select auth.uid()) and s.plan_id = p.id
  where p.id = coalesce(
    (select s2.plan_id from public.subscriptions s2
      where s2.user_id = (select auth.uid()) and s2.status in ('active', 'trialing', 'past_due')),
    'free')
$$;
revoke all on function public.billing_overview() from public, anon;
grant execute on function public.billing_overview() to authenticated;
