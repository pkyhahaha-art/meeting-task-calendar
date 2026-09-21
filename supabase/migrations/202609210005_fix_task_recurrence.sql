-- Avoid a PL/pgSQL record variable shadowing the Task-series table alias.
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
  join public.tasks series_root on series_root.id = child.recurrence_series_id
  join public.task_reminders template on template.task_id = series_root.id
  where child.deleted_at is null and child.status = 'pending'
  on conflict (task_id, reminder_key, scheduled_at) do nothing;
  return generated;
end;
$$;
