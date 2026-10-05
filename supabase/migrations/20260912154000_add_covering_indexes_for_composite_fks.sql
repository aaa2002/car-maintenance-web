-- Cover the (car_id, user_id) foreign keys so cascading deletes from `cars` do not scan.
create index if not exists repairs_car_id_user_id_idx on public.repairs (car_id, user_id);
create index if not exists trips_car_id_user_id_idx on public.trips (car_id, user_id);
create index if not exists compliance_records_car_id_user_id_idx
  on public.compliance_records (car_id, user_id);
