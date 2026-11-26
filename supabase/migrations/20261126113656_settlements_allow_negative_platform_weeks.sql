-- Refunds can make a driver's platform week negative. Imports store the real figure instead of hiding it in the adjustment.
alter table public.weekly_settlements
  drop constraint weekly_settlements_bolt_earnings_check,
  drop constraint weekly_settlements_uber_earnings_check;
