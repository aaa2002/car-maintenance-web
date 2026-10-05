-- Match the other RPCs: only signed-in users may call the conversion helper.
revoke all on function public.convert_currency(double precision, text, text, date) from public, anon;
grant execute on function public.convert_currency(double precision, text, text, date) to authenticated;
