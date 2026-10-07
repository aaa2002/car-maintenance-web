-- One billing-sync request per affected user per statement (not per row): bulk imports or
-- deletes would otherwise fire one request per vehicle and hit Stripe's rate limit.
drop trigger if exists cars_request_billing_sync on public.cars;

create or replace function private.request_billing_sync_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_url text;
  v_token text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'billing_sync_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'billing_sync_token';
  if v_url is null or v_token is null then
    return null;
  end if;
  for v_user in
    select distinct user_id from changed_cars
  loop
    if private.effective_plan(v_user) = 'fleet' then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-billing-sync-token', v_token),
        body := jsonb_build_object('user_id', v_user)
      );
    end if;
  end loop;
  return null;
end;
$$;

create trigger cars_request_billing_sync_after_insert
  after insert on public.cars
  referencing new table as changed_cars
  for each statement execute function private.request_billing_sync_batch();
create trigger cars_request_billing_sync_after_delete
  after delete on public.cars
  referencing old table as changed_cars
  for each statement execute function private.request_billing_sync_batch();

drop function if exists private.request_billing_sync();
revoke all on all functions in schema private from public, anon, authenticated;
