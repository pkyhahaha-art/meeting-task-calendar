-- Clean up expired external task tokens in the hourly maintenance job.
-- Tokens older than 1 day past their expires_at are safe to remove because
-- taskForToken() already rejects them at access time.

create or replace function public.run_scheduled_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_events integer;
  removed_tasks integer;
  removed_logs integer;
  run_identifier uuid := gen_random_uuid();
begin
  delete from public.events
    where (deleted_at is not null and deleted_at < now() - interval '30 days')
      or (deleted_at is null and status = 'scheduled'
        and coalesce(end_datetime, start_datetime) < now() - interval '72 hours'
        and recurrence_rule is null);
  get diagnostics removed_events = row_count;
  delete from public.tasks where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics removed_tasks = row_count;
  delete from public.audit_logs where created_at < now() - interval '90 days';
  get diagnostics removed_logs = row_count;
  delete from public.notification_deliveries where created_at < now() - interval '90 days';
  delete from public.system_logs where created_at < now() - interval '90 days';
  delete from public.line_link_codes where expires_at < now() - interval '1 day';
  -- Remove expired external task access tokens (grace period: 1 day after expiry).
  delete from public.external_task_tokens
    where expires_at is not null and expires_at < now() - interval '1 day';
  insert into public.system_logs(job_name, run_id, status, processed_count, details)
  values ('scheduled-maintenance', run_identifier, 'completed', removed_events + removed_tasks + removed_logs,
    jsonb_build_object('events', removed_events, 'tasks', removed_tasks, 'audit_logs', removed_logs));
  return jsonb_build_object('events', removed_events, 'tasks', removed_tasks, 'audit_logs', removed_logs);
exception when others then
  insert into public.system_logs(job_name, run_id, status, details)
  values ('scheduled-maintenance', run_identifier, 'failed', jsonb_build_object('error', sqlerrm));
  raise;
end;
$$;
