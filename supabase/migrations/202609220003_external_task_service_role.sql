-- Allow the external-task Edge Function to access only the Task data it serves.
grant select, update on table public.tasks to service_role;
grant insert on table public.notification_deliveries to service_role;
grant select, insert on table public.task_attachments to service_role;
grant select on table public.document_links to service_role;
