-- Generate recurring Task instances and let an Edge Function remove private files before retention deletes rows.

create or replace function public.queue_task_email_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  task_row public.tasks;
  recipient text;
  recipient_kind text;
  template text;
  payload jsonb;
begin
  if current_setting('app.materializing_task_series', true) = 'true' then return new; end if;
  task_row := new;
  template := case
    when tg_op = 'INSERT' then 'task_assigned'
    when new.status = 'completed' and old.status <> 'completed' then 'task_completed'
    when new.status = 'cancelled' then 'task_cancelled'
    else 'task_updated'
  end;
  payload := jsonb_build_object('entity', 'task', 'id', task_row.id, 'title', task_row.title,
    'description', task_row.description, 'due_date', task_row.due_date, 'due_time', task_row.due_time, 'status', task_row.status);
  if template = 'task_completed' then
    select p.email into recipient from public.profiles p where p.id = task_row.creator_user_id;
    perform public.queue_notification(null, task_row.id, 'task_creator', recipient, template, payload);
    return new;
  end if;
  if task_row.assignee_type = 'external' and template in ('task_assigned', 'task_updated') then return new; end if;
  if task_row.assignee_type = 'internal' then
    recipient_kind := 'task_assignee';
    select p.email into recipient from public.profiles p where p.id = task_row.assignee_user_id;
  else
    recipient_kind := 'external_assignee';
    recipient := task_row.external_assignee_email;
  end if;
  perform public.queue_notification(null, task_row.id, recipient_kind, recipient, template, payload);
  return new;
end;
$$;

create or replace function public.materialize_recurring_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  root record;
  candidate date;
  generated integer := 0;
begin
  perform set_config('app.materializing_task_series', 'true', true);
  for root in
    select * from public.tasks
    where recurrence_rule is not null and recurrence_series_id is null
      and status = 'pending' and deleted_at is null
  loop
    for candidate in
      select value::date from (
        select case
          when root.recurrence_rule like 'FREQ=DAILY%' then root.due_date + n
          when root.recurrence_rule like 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR%' then root.due_date + n
          when root.recurrence_rule like 'FREQ=WEEKLY%' then root.due_date + n * 7
          when root.recurrence_rule like 'FREQ=MONTHLY%' then (root.due_date + (n || ' months')::interval)::date
          when root.recurrence_rule like 'FREQ=YEARLY%' then (root.due_date + (n || ' years')::interval)::date
        end as value,
        n
        from generate_series(1, 730) n
      ) generated_dates
      where value is not null and value <= current_date + 365
        and (root.recurrence_end_at is null or value::date <= root.recurrence_end_at)
        and (root.recurrence_rule not like 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR%' or extract(isodow from value) between 1 and 5)
        and (root.recurrence_rule not like 'FREQ=MONTHLY%' or extract(day from value) = extract(day from root.due_date))
    loop
      insert into public.tasks(
        creator_user_id, assignee_type, assignee_user_id, external_assignee_email,
        linked_event_id, title, description, due_date, due_time, timezone,
        recurrence_series_id
      ) values (
        root.creator_user_id, root.assignee_type, root.assignee_user_id, root.external_assignee_email,
        root.linked_event_id, root.title, root.description, candidate, root.due_time, root.timezone,
        root.id
      ) on conflict (recurrence_series_id, due_date, coalesce(due_time, '00:00:00'::time))
      where recurrence_series_id is not null do nothing;
      generated := generated + 1;
    end loop;
  end loop;

  insert into public.task_reminders(task_id, reminder_key, scheduled_at, channel_email, channel_line, status)
  select child.id, template.reminder_key,
    case when template.reminder_key = 'overdue'
      then ((child.due_date + 1 + '09:00:00'::time) at time zone child.timezone)
      else ((child.due_date + coalesce(child.due_time, '09:00:00'::time)) at time zone child.timezone) - case template.reminder_key
        when '1_hour' then interval '1 hour'
        when '1_day' then interval '1 day'
        when '3_days' then interval '3 days'
        else interval '0 hours'
      end
    end,
    template.channel_email, template.channel_line, 'scheduled'
  from public.tasks child
  join public.tasks root on root.id = child.recurrence_series_id
  join public.task_reminders template on template.task_id = root.id
  where child.deleted_at is null and child.status = 'pending'
  on conflict (task_id, reminder_key, scheduled_at) do nothing;
  return generated;
end;
$$;

create or replace function public.cancel_generated_tasks_on_series_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.recurrence_series_id is null and old.recurrence_rule is not null and
    (new.deleted_at is not null or new.status = 'cancelled' or new.recurrence_rule is null) then
    perform set_config('app.materializing_task_series', 'true', true);
    update public.tasks set status = 'cancelled', deleted_at = coalesce(deleted_at, now())
      where recurrence_series_id = old.id and due_date >= current_date and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists cancel_generated_tasks_on_series_change on public.tasks;
create trigger cancel_generated_tasks_on_series_change
  after update of status, deleted_at, recurrence_rule on public.tasks
  for each row execute function public.cancel_generated_tasks_on_series_change();

create or replace function public.maintenance_storage_candidates()
returns table(bucket_id text, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'meeting-documents'::text, attachment.storage_path
  from public.attachments attachment join public.events event on event.id = attachment.event_id
  where (event.deleted_at is not null and event.deleted_at < now() - interval '30 days')
    or (event.deleted_at is null and event.status = 'scheduled' and event.recurrence_rule is null
      and coalesce(event.end_datetime, event.start_datetime) < now() - interval '72 hours')
  union all
  select 'task-documents'::text, attachment.storage_path
  from public.task_attachments attachment join public.tasks task on task.id = attachment.task_id
  where task.deleted_at is not null and task.deleted_at < now() - interval '30 days';
$$;

revoke all on function public.materialize_recurring_tasks() from public;
revoke all on function public.maintenance_storage_candidates() from public;
grant execute on function public.materialize_recurring_tasks() to service_role;
grant execute on function public.maintenance_storage_candidates() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('maintenance-hourly', 'maintenance-edge-hourly', 'materialize-recurring-tasks-daily');
    perform cron.schedule('materialize-recurring-tasks-daily', '25 0 * * *', 'select public.materialize_recurring_tasks()');
    perform cron.schedule(
      'maintenance-edge-hourly', '20 * * * *',
      $command$select net.http_post(
        url := 'https://gpcavspjxssegdqenaud.supabase.co/functions/v1/scheduled-maintenance',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notification_cron_secret')),
        timeout_milliseconds := 5000
      )$command$
    );
  end if;
end $$;
