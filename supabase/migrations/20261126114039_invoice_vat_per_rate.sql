-- e-Factura (EN 16931, BR-CO-17) computes VAT once per rate on the summed line amounts; line VAT is informative.
create or replace function public.issue_invoice(
  p_driver_id bigint,
  p_settlement_id bigint,
  p_issue_date date,
  p_due_date date,
  p_currency text,
  p_lines jsonb,
  p_notes text default null,
  p_storno_of bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_company public.company_profiles;
  v_driver public.drivers;
  v_week date;
  v_number integer;
  v_invoice_id bigint;
  v_line jsonb;
  v_position integer := 0;
  v_quantity numeric; v_price numeric; v_rate numeric; v_category text; v_net numeric;
  v_total_net numeric; v_total_vat numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_company from public.company_profiles where user_id = v_user for update;
  if not found then raise exception 'company_profile_missing'; end if;
  select * into v_driver from public.drivers where id = p_driver_id and user_id = v_user;
  if not found then raise exception 'Driver not found'; end if;
  if p_settlement_id is not null then
    select week_start into v_week from public.weekly_settlements where id = p_settlement_id and user_id = v_user and driver_id = p_driver_id;
    if not found then raise exception 'Settlement not found'; end if;
  end if;
  if p_storno_of is not null and not exists (select 1 from public.invoices where id = p_storno_of and user_id = v_user and status = 'issued' and storno_of is null) then
    raise exception 'Invoice not found';
  end if;
  if p_currency not in ('RON', 'EUR') then raise exception 'Invalid currency'; end if;
  if p_due_date < p_issue_date then raise exception 'invoice_due_before_issue'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'invoice_no_lines'; end if;

  v_number := v_company.next_invoice_number;
  update public.company_profiles set next_invoice_number = v_number + 1 where user_id = v_user;

  insert into public.invoices (user_id, series, number, issue_date, due_date, driver_id, settlement_id, week_start, currency, seller, buyer, total_net, total_vat, total, storno_of, notes)
  values (
    v_user, v_company.invoice_series, v_number, p_issue_date, p_due_date, p_driver_id, p_settlement_id, v_week, p_currency,
    jsonb_build_object('name', v_company.name, 'taxId', v_company.tax_id, 'vatPayer', v_company.vat_payer, 'regNo', v_company.reg_no,
      'address', v_company.address, 'city', v_company.city, 'county', v_company.county, 'country', v_company.country,
      'iban', v_company.iban, 'bank', v_company.bank, 'email', v_company.email, 'phone', v_company.phone, 'note', v_company.invoice_note),
    jsonb_build_object('name', coalesce(nullif(trim(v_driver.billing_name), ''), v_driver.full_name), 'taxId', v_driver.billing_tax_id,
      'regNo', v_driver.billing_reg_no, 'address', v_driver.billing_address, 'city', v_driver.billing_city, 'county', v_driver.billing_county,
      'country', 'RO', 'email', v_driver.email, 'phone', v_driver.phone),
    0, 0, 0, p_storno_of, nullif(trim(p_notes), '')
  ) returning id into v_invoice_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_position := v_position + 1;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_price := (v_line ->> 'unitPrice')::numeric;
    if v_quantity is null or v_quantity = 0 or v_price is null or coalesce(trim(v_line ->> 'description'), '') = '' then raise exception 'invoice_line_invalid'; end if;
    -- A company outside the VAT system invoices every line as "not subject to VAT".
    if not v_company.vat_payer then v_category := 'O'; v_rate := 0;
    else
      v_rate := coalesce((v_line ->> 'vatRate')::numeric, v_company.default_vat_rate);
      if v_rate < 0 or v_rate > 100 then raise exception 'invoice_line_invalid'; end if;
      v_category := case when v_rate > 0 then 'S' else 'E' end;
    end if;
    v_net := round(v_quantity * round(v_price, 4), 2);
    insert into public.invoice_lines (invoice_id, user_id, position, description, quantity, unit, unit_price, vat_category, vat_rate, net, vat)
    values (v_invoice_id, v_user, v_position, trim(v_line ->> 'description'), v_quantity, coalesce(nullif(v_line ->> 'unit', ''), 'C62'), round(v_price, 4), v_category, v_rate, v_net, round(v_net * v_rate / 100, 2));
  end loop;

  select coalesce(sum(net), 0) into v_total_net from public.invoice_lines where invoice_id = v_invoice_id;
  select coalesce(sum(round(taxable * rate / 100, 2)), 0) into v_total_vat
  from (select vat_category, vat_rate as rate, sum(net) as taxable from public.invoice_lines where invoice_id = v_invoice_id group by vat_category, vat_rate) per_rate;

  update public.invoices set total_net = v_total_net, total_vat = v_total_vat, total = v_total_net + v_total_vat where id = v_invoice_id;
  if p_storno_of is not null then update public.invoices set status = 'cancelled' where id = p_storno_of; end if;
  return v_invoice_id;
end;
$$;
revoke all on function public.issue_invoice(bigint, bigint, date, date, text, jsonb, text, bigint) from public, anon;
grant execute on function public.issue_invoice(bigint, bigint, date, date, text, jsonb, text, bigint) to authenticated;
