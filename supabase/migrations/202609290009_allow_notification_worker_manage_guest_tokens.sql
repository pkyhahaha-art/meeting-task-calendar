-- Guest links are created and read only by server-side Edge Functions.
grant select, insert, update on table public.guest_tokens to service_role;
