-- Apply this follow-up when the first migration was already run before the
-- project was configured with "Automatically expose new tables" disabled.
grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.line_connections to authenticated;
grant select, insert, update, delete on table public.events to authenticated;
grant select, insert, update, delete on table public.event_occurrences to authenticated;
grant select, insert, update, delete on table public.event_guests to authenticated;
grant select, insert, update, delete on table public.attachments to authenticated;
grant select, insert, update, delete on table public.reminders to authenticated;
grant select on table public.notification_deliveries to authenticated;
grant select on table public.audit_logs to authenticated;
grant select on table public.system_logs to authenticated;
