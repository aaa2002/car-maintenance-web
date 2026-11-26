-- Romanian invoices must carry the buyer's address, and e-Factura rejects them without street, city and county.
create or replace function private.require_invoice_buyer_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(trim(new.buyer ->> 'address'), '') = '' or coalesce(trim(new.buyer ->> 'city'), '') = '' or coalesce(trim(new.buyer ->> 'county'), '') = '' then
    raise exception 'buyer_address_missing';
  end if;
  return new;
end;
$$;
revoke all on function private.require_invoice_buyer_address() from public, anon, authenticated;
create trigger invoices_require_buyer_address
  before insert on public.invoices
  for each row execute function private.require_invoice_buyer_address();
