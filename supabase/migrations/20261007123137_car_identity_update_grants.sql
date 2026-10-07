-- Owners edit their vehicles' identity and usage; locked and mileage_updated_on stay system-managed.
grant update (plate_number, vin, fuel_type, euro_class, ridesharing) on public.cars to authenticated;
