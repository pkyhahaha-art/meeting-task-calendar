begin;
CREATE OR REPLACE FUNCTION public.run_scheduled_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  removed_events integer;
  removed_tasks integer;
  removed_logs integer;
  run_identifier uuid := gen_random_uuid();
begin
  delete from public.events
    where deleted_at is not null and deleted_at < now() - interval '30 days';
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
$function$;

CREATE OR REPLACE FUNCTION public.maintenance_storage_candidates()
 RETURNS TABLE(bucket_id text, storage_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'meeting-documents'::text, attachment.storage_path
  from public.attachments attachment join public.events event on event.id = attachment.event_id
  where event.deleted_at is not null and event.deleted_at < now() - interval '30 days'
  union all
  select 'task-documents'::text, attachment.storage_path
  from public.task_attachments attachment join public.tasks task on task.id = attachment.task_id
  where task.deleted_at is not null and task.deleted_at < now() - interval '30 days';
$function$;

commit;
