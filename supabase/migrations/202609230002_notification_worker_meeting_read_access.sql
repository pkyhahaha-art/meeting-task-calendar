-- The notification worker runs as service_role and builds email cards from these records.
grant select on table public.events, public.attachments, public.profiles to service_role;
