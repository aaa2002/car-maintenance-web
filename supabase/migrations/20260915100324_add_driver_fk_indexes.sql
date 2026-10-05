create index driver_assignments_driver_fk_idx
  on public.driver_assignments (driver_id, user_id);

create index weekly_settlements_driver_fk_idx
  on public.weekly_settlements (driver_id, user_id);
