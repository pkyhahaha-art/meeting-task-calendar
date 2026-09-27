-- The reporting Edge Function runs with the service role and exports these logs read-only.
grant select on table public.audit_logs, public.system_logs to service_role;
