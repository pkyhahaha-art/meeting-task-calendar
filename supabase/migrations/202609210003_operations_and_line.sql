-- Complete recurring schedules, LINE reminder delivery, maintenance, and LINE linking.

create table if not exists public.line_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on table public.line_link_codes from anon, authenticated;
alter table public.line_link_codes enable row level security;
create index if not exists line_link_codes_active_idx on public.line_link_codes(expires_at) where used_at is null;

create unique index if not exists occurrence_reminder_unique
  on public.reminders(occurrence_id, offset_value, offset_unit)
  where occurrence_id is not null;

create unique index if not exists task_recurrence_due_unique
  on public.tasks(recurrence_series_id, due_date, coalesce(due_time, '00:00:00'::time))
  where recurrence_series_id is not null;

create or replace function public.materialize_event_occurrences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row record;
  candidate timestamptz;
  occurrence_count integer := 0;
begin
  for event_row in
    select * from public.events
    where recurrence_rule is not null and status = 'scheduled' and deleted_at is null
  loop
    for candidate in
      select value
      from (
        select case
          when event_row.recurrence_rule like 'FREQ=DAILY%' then event_row.start_datetime + n * interval '1 day'
          when event_row.recurrence_rule like 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR%' then event_row.start_datetime + n * interval '1 day'
          when event_row.recurrence_rule like 'FREQ=WEEKLY%' then event_row.start_datetime + n * interval '7 days'
          when event_row.recurrence_rule like 'FREQ=MONTHLY%' then event_row.start_datetime + n * interval '1 month'
          when event_row.recurrence_rule like 'FREQ=YEARLY%' then event_row.start_datetime + n * interval '1 year'
        end as value,
        n
        from generate_series(0, 370) n
      ) generated
      where value is not null
        and value <= now() + interval '12 months'
        and (event_row.recurrence_until is null or value <= event_row.recurrence_until)
        and (event_row.recurrence_count is null or n < event_row.recurrence_count)
        and (event_row.recurrence_rule not like 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR%'
          or extract(isodow from value) between 1 and 5)
        and (event_row.recurrence_rule not like 'FREQ=MONTHLY%'
          or extract(day from value) = extract(day from event_row.start_datetime))
    loop
      insert into public.event_occurrences(
        event_id, occurrence_key, start_datetime, end_datetime, status
      ) values (
        event_row.id,
        candidate,
        candidate,
        case when event_row.end_datetime is null then null
          else candidate + (event_row.end_datetime - event_row.start_datetime) end,
        'scheduled'
      ) on conflict (event_id, occurrence_key) do update set
        start_datetime = excluded.start_datetime,
        end_datetime = excluded.end_datetime,
        updated_at = now();
      occurrence_count := occurrence_count + 1;
    end loop;
  end loop;

  insert into public.reminders(
    event_id, occurrence_id, offset_value, offset_unit, scheduled_at,
    channel_email, channel_line, status
  )
  select template.event_id, occurrence.id, template.offset_value, template.offset_unit,
    occurrence.start_datetime - case template.offset_unit
      when 'minute' then make_interval(mins => template.offset_value)
      when 'hour' then make_interval(hours => template.offset_value)
      when 'day' then make_interval(days => template.offset_value)
      when 'week' then make_interval(days => template.offset_value * 7)
      when 'month' then make_interval(months => template.offset_value)
    end,
    template.channel_email, template.channel_line, 'scheduled'
  from public.event_occurrences occurrence
  join public.reminders template
    on template.event_id = occurrence.event_id and template.occurrence_id is null
  where occurrence.occurrence_key > (select start_datetime from public.events where id = occurrence.event_id)
  on conflict (occurrence_id, offset_value, offset_unit) where occurrence_id is not null
  do update set channel_email = excluded.channel_email, channel_line = excluded.channel_line;

  return occurrence_count;
end;
$$;

create or replace function public.queue_line_delivery(
  target_reminder_id uuid,
  target_event_id uuid,
  target_task_id uuid,
  target_recipient_type text,
  target_line_user_id text,
  target_template text,
  target_payload jsonb,
  target_scheduled_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_line_user_id is null or btrim(target_line_user_id) = '' then return; end if;
  insert into public.notification_deliveries(
    reminder_id, task_reminder_id, event_id, task_id, recipient_type,
    recipient_reference, channel, idempotency_key, scheduled_at, template_key, payload
  ) values (
    case when target_task_id is null then target_reminder_id else null end,
    case when target_task_id is not null then target_reminder_id else null end,
    target_event_id, target_task_id, target_recipient_type, target_line_user_id, 'line',
    concat('line-reminder:', target_reminder_id::text, ':', target_line_user_id, ':',
      to_char(target_scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MISS')),
    target_scheduled_at, target_template, coalesce(target_payload, '{}'::jsonb)
  ) on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.queue_due_line_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  line_id text;
  queued integer := 0;
begin
  for item in
    select r.*, e.owner_user_id, e.title, e.description, e.start_datetime, e.end_datetime,
      e.location, e.status as entity_status, e.deleted_at
    from public.reminders r join public.events e on e.id = r.event_id
    where r.status = 'scheduled' and r.channel_line and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if item.entity_status <> 'scheduled' or item.deleted_at is not null then
      update public.reminders set status = 'cancelled' where id = item.id;
      continue;
    end if;
    select line_user_id into line_id from public.line_connections
      where user_id = item.owner_user_id and disconnected_at is null;
    perform public.queue_line_delivery(item.id, item.event_id, null, 'owner', line_id,
      'meeting_reminder', jsonb_build_object('title', item.title, 'description', item.description,
      'start_datetime', item.start_datetime, 'end_datetime', item.end_datetime, 'location', item.location), item.scheduled_at);
    if not item.channel_email then update public.reminders set status = 'completed' where id = item.id; end if;
    queued := queued + 1;
  end loop;

  for item in
    select r.*, t.creator_user_id, t.assignee_user_id, t.assignee_type, t.title,
      t.description, t.due_date, t.due_time, t.status as entity_status, t.deleted_at
    from public.task_reminders r join public.tasks t on t.id = r.task_id
    where r.status = 'scheduled' and r.channel_line and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if item.entity_status <> 'pending' or item.deleted_at is not null then
      update public.task_reminders set status = 'cancelled' where id = item.id;
      continue;
    end if;
    if item.assignee_type = 'internal' then
      select line_user_id into line_id from public.line_connections
        where user_id = item.assignee_user_id and disconnected_at is null;
      perform public.queue_line_delivery(item.id, null, item.task_id, 'task_assignee', line_id,
        'task_reminder', jsonb_build_object('title', item.title, 'description', item.description,
        'due_date', item.due_date, 'due_time', item.due_time), item.scheduled_at);
    end if;
    if item.reminder_key = 'overdue' then
      select line_user_id into line_id from public.line_connections
        where user_id = item.creator_user_id and disconnected_at is null;
      perform public.queue_line_delivery(item.id, null, item.task_id, 'task_creator', line_id,
        'task_reminder', jsonb_build_object('title', item.title, 'description', item.description,
        'due_date', item.due_date, 'due_time', item.due_time), item.scheduled_at);
    end if;
    if not item.channel_email then update public.task_reminders set status = 'completed' where id = item.id; end if;
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

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

create or replace function public.requeue_stale_email_deliveries()
returns integer
language sql
security definer
set search_path = ''
as $$
  with recovered as (
    update public.notification_deliveries
    set status = case when attempt < 4 then 'retry' else 'failed' end,
      next_attempt_at = case when attempt < 4 then now() else null end,
      error_code = 'processing_timeout',
      error_message = 'Delivery worker did not finish within 20 minutes.'
    where status = 'processing' and updated_at < now() - interval '20 minutes'
    returning id
  )
  select count(*)::integer from recovered;
$$;

revoke all on function public.materialize_event_occurrences() from public;
revoke all on function public.queue_line_delivery(uuid, uuid, uuid, text, text, text, jsonb, timestamptz) from public;
revoke all on function public.queue_due_line_reminders() from public;
revoke all on function public.run_scheduled_maintenance() from public;
grant execute on function public.materialize_event_occurrences() to service_role;
grant execute on function public.queue_due_line_reminders() to service_role;
grant execute on function public.run_scheduled_maintenance() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'materialize-recurring-events-daily';
    perform cron.unschedule(jobid) from cron.job where jobname = 'maintenance-hourly';
    perform cron.schedule('materialize-recurring-events-daily', '15 0 * * *', 'select public.materialize_event_occurrences()');
    perform cron.schedule('maintenance-hourly', '20 * * * *', 'select public.run_scheduled_maintenance()');
  end if;
end $$;
