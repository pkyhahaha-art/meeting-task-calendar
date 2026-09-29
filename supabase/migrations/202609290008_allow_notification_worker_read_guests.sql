-- The notification worker and guest endpoint use service_role to resolve
-- the attendee tied to a time-limited guest link.
grant select on table public.event_guests to service_role;
