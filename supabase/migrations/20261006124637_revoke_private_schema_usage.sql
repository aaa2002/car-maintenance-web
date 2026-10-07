-- Trigger functions do not need EXECUTE or schema USAGE for API roles; keep the private schema closed.
revoke execute on function private.block_locked_vehicle_children() from authenticated;
revoke usage on schema private from authenticated;
