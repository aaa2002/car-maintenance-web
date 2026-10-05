alter table public.profiles enable row level security;
alter table public.cars enable row level security;
alter table public.repairs enable row level security;
alter table public.trips enable row level security;
alter table public.compliance_records enable row level security;

-- Profiles: a user may only ever see and edit their own profile row.
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "cars_select_own" on public.cars
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "cars_insert_own" on public.cars
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "cars_update_own" on public.cars
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "cars_delete_own" on public.cars
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "repairs_select_own" on public.repairs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "repairs_insert_own" on public.repairs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "repairs_update_own" on public.repairs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "repairs_delete_own" on public.repairs
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "trips_select_own" on public.trips
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "trips_insert_own" on public.trips
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "trips_update_own" on public.trips
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "trips_delete_own" on public.trips
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "compliance_select_own" on public.compliance_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "compliance_insert_own" on public.compliance_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "compliance_update_own" on public.compliance_records
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "compliance_delete_own" on public.compliance_records
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Give every new auth user a profile row automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
