-- Private buckets. Every object key must start with the owner's uid: "<uid>/<...>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('car-photos', 'car-photos', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('car-documents', 'car-documents', false, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy "car_photos_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'car-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "car_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'car-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "car_photos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'car-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'car-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "car_photos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'car-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "car_documents_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'car-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "car_documents_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'car-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "car_documents_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'car-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'car-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "car_documents_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'car-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Daily spend for the Spend tab. SECURITY INVOKER (the default) so RLS still applies
-- and a caller can only ever aggregate their own rows.
create or replace function public.daily_spend_for_month(
  p_currency text,
  p_month_start date,
  p_next_month_start date,
  p_car_id bigint default null
)
returns table (date date, repair_spend double precision, trip_spend double precision)
language sql
stable
set search_path = ''
as $$
  with repair_spend as (
    select r.date, sum(r.price) as total
    from public.repairs r
    where r.date >= p_month_start
      and r.date < p_next_month_start
      and r.status = 'done'
      and r.currency = p_currency
      and (p_car_id is null or r.car_id = p_car_id)
    group by r.date
  ),
  trip_spend as (
    select t.date, sum(t.price) as total
    from public.trips t
    where t.date >= p_month_start
      and t.date < p_next_month_start
      and t.status = 'done'
      and t.currency = p_currency
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

revoke all on function public.daily_spend_for_month(text, date, date, bigint) from public, anon;
grant execute on function public.daily_spend_for_month(text, date, date, bigint) to authenticated;
