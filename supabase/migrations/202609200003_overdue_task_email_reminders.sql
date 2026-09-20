-- Send overdue Task reminders to both the assignee and creator at 09:00
-- Asia/Bangkok, once per day for no more than three days.

alter table public.notification_deliveries
  add column if not exists task_reminder_id uuid references public.task_reminders(id) on delete set null;

create or replace function public.queue_email_reminder_delivery(
  target_reminder_id uuid,
  target_event_id uuid,
  target_task_id uuid,
  target_recipient_type text,
  target_recipient text,
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
  if target_recipient is null or btrim(target_recipient) = '' then
    return;
  end if;

  insert into public.notification_deliveries (
    reminder_id, task_reminder_id, event_id, task_id, recipient_type, recipient_reference, channel,
    idempotency_key, scheduled_at, template_key, payload
  )
  values (
    case when target_task_id is null then target_reminder_id else null end,
    case when target_task_id is not null then target_reminder_id else null end,
    target_event_id, target_task_id, target_recipient_type,
    lower(btrim(target_recipient)), 'email',
    concat(
      'email-reminder:', target_reminder_id::text, ':', lower(btrim(target_recipient)), ':',
      to_char(target_scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MISS')
    ),
    target_scheduled_at, target_template, coalesce(target_payload, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.queue_due_email_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_reminder record;
  task_reminder record;
  guest_row record;
  recipient text;
  creator_email text;
  overdue_day integer;
  delivery_scheduled_at timestamptz;
  queued_count integer := 0;
begin
  for event_reminder in
    select r.id, r.scheduled_at, e.id as event_id, e.owner_user_id, e.title, e.description,
      e.start_datetime, e.end_datetime, e.location, e.status, e.deleted_at
    from public.reminders r
    join public.events e on e.id = r.event_id
    where r.status = 'scheduled' and r.channel_email and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if event_reminder.status <> 'scheduled' or event_reminder.deleted_at is not null then
      update public.reminders set status = 'cancelled' where id = event_reminder.id;
      continue;
    end if;

    select p.email into recipient from public.profiles p where p.id = event_reminder.owner_user_id;
    perform public.queue_email_reminder_delivery(
      event_reminder.id, event_reminder.event_id, null, 'owner', recipient, 'meeting_reminder',
      jsonb_build_object(
        'entity', 'meeting', 'id', event_reminder.event_id, 'title', event_reminder.title,
        'description', event_reminder.description, 'start_datetime', event_reminder.start_datetime,
        'end_datetime', event_reminder.end_datetime, 'location', event_reminder.location
      ),
      event_reminder.scheduled_at
    );

    for guest_row in
      select email from public.event_guests
      where event_id = event_reminder.event_id and revoked_at is null
    loop
      perform public.queue_email_reminder_delivery(
        event_reminder.id, event_reminder.event_id, null, 'guest', guest_row.email, 'meeting_reminder',
        jsonb_build_object(
          'entity', 'meeting', 'id', event_reminder.event_id, 'title', event_reminder.title,
          'description', event_reminder.description, 'start_datetime', event_reminder.start_datetime,
          'end_datetime', event_reminder.end_datetime, 'location', event_reminder.location
        ),
        event_reminder.scheduled_at
      );
    end loop;

    update public.reminders set status = 'completed' where id = event_reminder.id;
    queued_count := queued_count + 1;
  end loop;

  for task_reminder in
    select r.id, r.reminder_key, r.scheduled_at, t.id as task_id, t.creator_user_id,
      t.assignee_type, t.assignee_user_id, t.external_assignee_email, t.title, t.description,
      t.due_date, t.due_time, t.status, t.deleted_at
    from public.task_reminders r
    join public.tasks t on t.id = r.task_id
    where r.status = 'scheduled' and r.channel_email and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if task_reminder.status <> 'pending' or task_reminder.deleted_at is not null then
      update public.task_reminders set status = 'cancelled' where id = task_reminder.id;
      continue;
    end if;

    if task_reminder.reminder_key = 'overdue' then
      overdue_day := (now() at time zone 'Asia/Bangkok')::date
        - (task_reminder.scheduled_at at time zone 'Asia/Bangkok')::date;

      if overdue_day > 2 then
        update public.task_reminders set status = 'completed' where id = task_reminder.id;
        continue;
      end if;

      delivery_scheduled_at := task_reminder.scheduled_at + overdue_day * interval '1 day';
    else
      delivery_scheduled_at := task_reminder.scheduled_at;
    end if;

    if task_reminder.assignee_type = 'internal' then
      select p.email into recipient from public.profiles p where p.id = task_reminder.assignee_user_id;
      perform public.queue_email_reminder_delivery(
        task_reminder.id, null, task_reminder.task_id, 'task_assignee', recipient, 'task_reminder',
        jsonb_build_object(
          'entity', 'task', 'id', task_reminder.task_id, 'title', task_reminder.title,
          'description', task_reminder.description, 'due_date', task_reminder.due_date,
          'due_time', task_reminder.due_time
        ),
        delivery_scheduled_at
      );
    else
      perform public.queue_email_reminder_delivery(
        task_reminder.id, null, task_reminder.task_id, 'external_assignee', task_reminder.external_assignee_email,
        'task_reminder',
        jsonb_build_object(
          'entity', 'task', 'id', task_reminder.task_id, 'title', task_reminder.title,
          'description', task_reminder.description, 'due_date', task_reminder.due_date,
          'due_time', task_reminder.due_time
        ),
        delivery_scheduled_at
      );
    end if;

    if task_reminder.reminder_key = 'overdue' then
      select p.email into creator_email from public.profiles p where p.id = task_reminder.creator_user_id;
      perform public.queue_email_reminder_delivery(
        task_reminder.id, null, task_reminder.task_id, 'task_creator', creator_email, 'task_reminder',
        jsonb_build_object(
          'entity', 'task', 'id', task_reminder.task_id, 'title', task_reminder.title,
          'description', task_reminder.description, 'due_date', task_reminder.due_date,
          'due_time', task_reminder.due_time
        ),
        delivery_scheduled_at
      );
    end if;

    if task_reminder.reminder_key <> 'overdue' or overdue_day = 2 then
      update public.task_reminders set status = 'completed' where id = task_reminder.id;
    end if;
    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$$;

revoke all on function public.queue_email_reminder_delivery(uuid, uuid, uuid, text, text, text, jsonb, timestamptz) from public;
revoke all on function public.queue_due_email_reminders() from public;
grant execute on function public.queue_due_email_reminders() to service_role;
grant select, update on table public.notification_deliveries to service_role;
