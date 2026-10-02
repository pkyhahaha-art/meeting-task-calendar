-- Migration: Support 2 task reminder modes (single vs continuous) and remove task recurrence

-- 1. Allow 'continuous' reminder key in task_reminders table
alter table public.task_reminders
  drop constraint if exists task_reminders_reminder_key_check;

alter table public.task_reminders
  add constraint task_reminders_reminder_key_check
  check (reminder_key in ('due', '1_hour', '1_day', '3_days', 'overdue', 'continuous'));

-- 2. Update queue_due_email_reminders
create or replace function public.queue_due_email_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  event_reminder record; task_reminder record; recipient record;
  creator_email text; overdue_day integer; delivery_scheduled_at timestamptz;
  queued_count integer := 0;
begin
  for event_reminder in
    select r.id, r.occurrence_id, r.scheduled_at, e.id as event_id, e.owner_user_id, e.title, e.description,
      coalesce(occurrence.start_datetime, e.start_datetime) as start_datetime,
      coalesce(occurrence.end_datetime, e.end_datetime) as end_datetime,
      e.location, e.status, e.deleted_at
    from public.reminders r
    join public.events e on e.id = r.event_id
    left join public.event_occurrences occurrence on occurrence.id = r.occurrence_id
    where r.status = 'scheduled' and r.channel_email and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if event_reminder.status <> 'scheduled' or event_reminder.deleted_at is not null then
      update public.reminders set status = 'cancelled' where id = event_reminder.id;
      continue;
    end if;
    select profile.email into creator_email from public.profiles profile where profile.id = event_reminder.owner_user_id;
    perform public.queue_email_reminder_delivery(event_reminder.id, event_reminder.event_id, null,
      'owner', creator_email, 'meeting_reminder',
      jsonb_build_object('entity', 'meeting', 'id', event_reminder.event_id,
        'title', event_reminder.title, 'description', event_reminder.description,
        'start_datetime', event_reminder.start_datetime, 'end_datetime', event_reminder.end_datetime,
        'location', event_reminder.location), event_reminder.scheduled_at);
    for recipient in select email from public.occurrence_guest_emails(event_reminder.event_id, event_reminder.occurrence_id) loop
      perform public.queue_email_reminder_delivery(event_reminder.id, event_reminder.event_id, null,
        'guest', recipient.email, 'meeting_reminder',
        jsonb_build_object('entity', 'meeting', 'id', event_reminder.event_id,
          'title', event_reminder.title, 'description', event_reminder.description,
          'start_datetime', event_reminder.start_datetime, 'end_datetime', event_reminder.end_datetime,
          'location', event_reminder.location), event_reminder.scheduled_at);
    end loop;
    update public.reminders set status = 'completed' where id = event_reminder.id;
    queued_count := queued_count + 1;
  end loop;

  for task_reminder in
    select r.id, r.reminder_key, r.scheduled_at, t.id as task_id, t.creator_user_id,
      t.title, t.description, t.due_date, t.due_time, t.status, t.deleted_at
    from public.task_reminders r join public.tasks t on t.id = r.task_id
    where r.status = 'scheduled' and r.channel_email and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if task_reminder.status <> 'pending' or task_reminder.deleted_at is not null then
      update public.task_reminders set status = 'cancelled' where id = task_reminder.id;
      continue;
    end if;
    if task_reminder.reminder_key = 'overdue' then
      overdue_day := (now() at time zone 'Asia/Bangkok')::date - (task_reminder.scheduled_at at time zone 'Asia/Bangkok')::date;
      if overdue_day > 2 then
        update public.task_reminders set status = 'completed' where id = task_reminder.id;
        continue;
      end if;
      delivery_scheduled_at := task_reminder.scheduled_at + overdue_day * interval '1 day';
    else
      delivery_scheduled_at := task_reminder.scheduled_at;
    end if;
    for recipient in select profile.email from public.task_internal_recipients member
      join public.profiles profile on profile.id = member.user_id
      where member.task_id = task_reminder.task_id and profile.status = 'active' loop
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'task_assignee', recipient.email, 'task_reminder',
        jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
          'title', task_reminder.title, 'description', task_reminder.description,
          'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time), delivery_scheduled_at);
    end loop;
    for recipient in select email from public.task_external_recipients where task_id = task_reminder.task_id loop
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'external_assignee', recipient.email, 'task_reminder',
        jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
          'title', task_reminder.title, 'description', task_reminder.description,
          'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time), delivery_scheduled_at);
    end loop;
    if task_reminder.reminder_key = 'overdue' then
      select profile.email into creator_email from public.profiles profile where profile.id = task_reminder.creator_user_id;
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'task_creator', creator_email, 'task_reminder',
        jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
          'title', task_reminder.title, 'description', task_reminder.description,
          'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time), delivery_scheduled_at);
    end if;
    if task_reminder.reminder_key <> 'overdue' or overdue_day = 2 then
      update public.task_reminders set status = 'completed' where id = task_reminder.id;
    end if;
    queued_count := queued_count + 1;
  end loop;
  return queued_count;
end;
$$;

-- 3. Update queue_due_line_reminders
create or replace function public.queue_due_line_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  line_id text;
  member record;
  queued integer := 0;
begin
  for item in
    select r.*, e.owner_user_id, e.title, e.description,
      coalesce(occurrence.start_datetime, e.start_datetime) as start_datetime,
      coalesce(occurrence.end_datetime, e.end_datetime) as end_datetime,
      e.location, e.status as entity_status, e.deleted_at
    from public.reminders r
    join public.events e on e.id = r.event_id
    left join public.event_occurrences occurrence on occurrence.id = r.occurrence_id
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
    for member in select profile.id from public.task_internal_recipients tir
      join public.profiles profile on profile.id = tir.user_id
      where tir.task_id = item.task_id and profile.status = 'active' loop
      select line_user_id into line_id from public.line_connections
        where user_id = member.id and disconnected_at is null;
      if line_id is not null then
        perform public.queue_line_delivery(item.id, null, item.task_id, 'task_assignee', line_id,
          'task_reminder', jsonb_build_object('title', item.title, 'description', item.description,
          'due_date', item.due_date, 'due_time', item.due_time), item.scheduled_at);
      end if;
    end loop;
    if item.reminder_key = 'overdue' then
      select line_user_id into line_id from public.line_connections
        where user_id = item.creator_user_id and disconnected_at is null;
      if line_id is not null then
        perform public.queue_line_delivery(item.id, null, item.task_id, 'task_creator', line_id,
          'task_reminder', jsonb_build_object('title', item.title, 'description', item.description,
          'due_date', item.due_date, 'due_time', item.due_time), item.scheduled_at);
      end if;
    end if;
    if not item.channel_email then update public.task_reminders set status = 'completed' where id = item.id; end if;
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

-- 4. Disable materialize_recurring_tasks pg_cron job and replace with no-op
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'materialize-recurring-tasks-daily';
  end if;
end;
$$;

create or replace function public.materialize_recurring_tasks()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  return 0;
end;
$$;

-- 5. Clean up any existing materialized recurring tasks and set recurrence_rule to null
update public.task_reminders
set status = 'cancelled'
where task_id in (
  select id from public.tasks where recurrence_series_id is not null and status = 'pending'
) and status in ('scheduled', 'deferred_quota');

update public.tasks
set deleted_at = coalesce(deleted_at, now()), status = 'cancelled'
where recurrence_series_id is not null and deleted_at is null;

update public.tasks
set recurrence_rule = null
where recurrence_rule is not null;
