-- pg_net keeps its functions in the net schema; only its registration moves out of public.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
