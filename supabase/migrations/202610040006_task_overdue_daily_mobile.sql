begin;

-- One shared daily slot for email and Push. Do not enqueue today's reminder
-- before 09:00 Bangkok, even if yesterday's reminder remains scheduled.
create or replace function public.task_overdue_reminder_slot(first_scheduled_at timestamptz, checked_at timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select case
    when day_number between 0 and 2 and daily_slot <= checked_at then daily_slot
    else null
  end
  from (
    select (checked_at at time zone 'Asia/Bangkok')::date
      - (first_scheduled_at at time zone 'Asia/Bangkok')::date as day_number,
      ((checked_at at time zone 'Asia/Bangkok')::date + time '09:00')
        at time zone 'Asia/Bangkok' as daily_slot
  ) slots;
$$;
revoke all on function public.task_overdue_reminder_slot(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.task_overdue_reminder_slot(timestamptz,timestamptz) to service_role;

-- Preserve Meeting processing and LINE's existing once-only idempotency key.
-- Mobile runs before email: leave the shared overdue row scheduled for three
-- days, and let email complete the final day when that channel is selected.
create or replace function public.queue_due_line_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record; member record; line_id text; queued integer := 0; message jsonb;
  delivery_scheduled_at timestamptz; overdue_day integer;
begin
  for item in
    select r.*, e.owner_user_id, e.title,
      coalesce(occurrence.override_payload->>'description',e.description) as description,
      coalesce(occurrence.start_datetime, e.start_datetime) as start_datetime,
      coalesce(occurrence.end_datetime, e.end_datetime) as end_datetime,
      coalesce(occurrence.override_payload->>'location',e.location) as location,
      e.mobile_notifications_enabled,e.status as entity_status, e.deleted_at,
      occurrence.id as resolved_occurrence_id,
      occurrence.status as occurrence_status
    from public.reminders r join public.events e on e.id = r.event_id
    left join public.event_occurrences occurrence on occurrence.id = r.occurrence_id
      or (r.occurrence_id is null and occurrence.event_id=e.id and occurrence.occurrence_key=e.start_datetime)
    where r.status = 'scheduled' and r.channel_line and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if item.entity_status <> 'scheduled' or item.deleted_at is not null or item.occurrence_status in ('cancelled','deleted') then
      update public.reminders set status = 'cancelled' where id = item.id;
      continue;
    end if;
    message := jsonb_build_object('entity', 'meeting', 'id', item.event_id,
      'occurrence_id', item.resolved_occurrence_id, 'title', item.title, 'description', item.description,
      'start_datetime', item.start_datetime, 'end_datetime', item.end_datetime, 'location', item.location);
    if item.mobile_notifications_enabled then
    perform public.queue_push_reminder_delivery(item.id, item.event_id, null, 'owner', item.owner_user_id, 'meeting_reminder', message, item.scheduled_at);
    for member in
      select guest.user_id from public.meeting_mobile_guest_users(item.event_id, item.resolved_occurrence_id) guest
      where guest.user_id <> item.owner_user_id
    loop
      perform public.queue_push_reminder_delivery(item.id, item.event_id, null,
        'registered_user', member.user_id, 'meeting_reminder', message, item.scheduled_at);
    end loop;
    end if;
    select line_user_id into line_id from public.line_connections where user_id = item.owner_user_id and disconnected_at is null;
    perform public.queue_line_delivery(item.id, item.event_id, null, 'owner', line_id, 'meeting_reminder', message, item.scheduled_at);
    if not item.channel_email then update public.reminders set status = 'completed' where id = item.id; end if;
    queued := queued + 1;
  end loop;

  for item in
    select r.*, t.creator_user_id, t.title, t.description, t.due_date, t.due_time,
      t.status as entity_status, t.deleted_at
    from public.task_reminders r join public.tasks t on t.id = r.task_id
    where r.status = 'scheduled' and r.channel_line and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if item.entity_status <> 'pending' or item.deleted_at is not null then
      update public.task_reminders set status = 'cancelled' where id = item.id;
      continue;
    end if;
    delivery_scheduled_at := item.scheduled_at;
    if item.reminder_key = 'overdue' then
      if (item.scheduled_at at time zone 'Asia/Bangkok')::date <> item.due_date + 1 then
        update public.task_reminders set status = 'cancelled' where id = item.id;
        continue;
      end if;
      overdue_day := (now() at time zone 'Asia/Bangkok')::date
        - (item.scheduled_at at time zone 'Asia/Bangkok')::date;
      if overdue_day > 2 then
        update public.task_reminders set status = 'completed' where id = item.id;
        continue;
      end if;
      delivery_scheduled_at := public.task_overdue_reminder_slot(item.scheduled_at, now());
      if delivery_scheduled_at is null then continue; end if;
    end if;
    message := jsonb_build_object('entity', 'task', 'id', item.task_id, 'title', item.title,
      'description', item.description, 'due_date', item.due_date, 'due_time', item.due_time);
    if item.reminder_key = 'overdue' then
      message := message || jsonb_build_object('reminder_key','overdue',
        'reminder_scheduled_at',delivery_scheduled_at);
    end if;
    for member in select profile.id from public.task_internal_recipients tir
      join public.profiles profile on profile.id = tir.user_id
      where tir.task_id = item.task_id and profile.status = 'active'
        and (item.reminder_key <> 'overdue' or profile.id <> item.creator_user_id)
    loop
      perform public.queue_push_reminder_delivery(item.id, null, item.task_id, 'task_assignee', member.id, 'task_reminder', message, delivery_scheduled_at);
      select line_user_id into line_id from public.line_connections where user_id = member.id and disconnected_at is null;
      perform public.queue_line_delivery(item.id, null, item.task_id, 'task_assignee', line_id, 'task_reminder', message, item.scheduled_at);
    end loop;
    if item.reminder_key = 'overdue' then
      perform public.queue_push_reminder_delivery(item.id, null, item.task_id, 'task_creator', item.creator_user_id, 'task_reminder', message, delivery_scheduled_at);
      select line_user_id into line_id from public.line_connections where user_id = item.creator_user_id and disconnected_at is null;
      perform public.queue_line_delivery(item.id, null, item.task_id, 'task_creator', line_id, 'task_reminder', message, item.scheduled_at);
    end if;
    if not item.channel_email and (item.reminder_key <> 'overdue' or overdue_day = 2) then
      update public.task_reminders set status = 'completed' where id = item.id;
    end if;
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

create or replace function public.queue_due_email_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  event_reminder record; task_reminder record; recipient record;
  creator_email text; overdue_day integer; delivery_scheduled_at timestamptz;
  queued_count integer := 0; message jsonb;
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
      if (task_reminder.scheduled_at at time zone 'Asia/Bangkok')::date <> task_reminder.due_date + 1 then
        update public.task_reminders set status = 'cancelled' where id = task_reminder.id;
        continue;
      end if;
      overdue_day := (now() at time zone 'Asia/Bangkok')::date
        - (task_reminder.scheduled_at at time zone 'Asia/Bangkok')::date;
      if overdue_day > 2 then
        update public.task_reminders set status = 'completed' where id = task_reminder.id;
        continue;
      end if;
      delivery_scheduled_at := public.task_overdue_reminder_slot(task_reminder.scheduled_at, now());
      if delivery_scheduled_at is null then continue; end if;
    else
      delivery_scheduled_at := task_reminder.scheduled_at;
    end if;
    message := jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
      'title', task_reminder.title, 'description', task_reminder.description,
      'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time);
    if task_reminder.reminder_key = 'overdue' then
      message := message || jsonb_build_object('reminder_key','overdue',
        'reminder_scheduled_at',delivery_scheduled_at);
    end if;
    for recipient in select profile.email from public.task_internal_recipients member
      join public.profiles profile on profile.id = member.user_id
      where member.task_id = task_reminder.task_id and profile.status = 'active'
        and (task_reminder.reminder_key <> 'overdue' or profile.id <> task_reminder.creator_user_id)
    loop
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'task_assignee', recipient.email, 'task_reminder', message, delivery_scheduled_at);
    end loop;
    for recipient in select email from public.task_external_recipients where task_id = task_reminder.task_id loop
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'external_assignee', recipient.email, 'task_reminder', message, delivery_scheduled_at);
    end loop;
    if task_reminder.reminder_key = 'overdue' then
      select profile.email into creator_email from public.profiles profile
        where profile.id = task_reminder.creator_user_id and profile.status = 'active';
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'task_creator', creator_email, 'task_reminder', message, delivery_scheduled_at);
    end if;
    if task_reminder.reminder_key <> 'overdue' or overdue_day = 2 then
      update public.task_reminders set status = 'completed' where id = task_reminder.id;
    end if;
    queued_count := queued_count + 1;
  end loop;
  return queued_count;
end;
$$;
revoke all on function public.queue_due_line_reminders() from public, anon, authenticated;
revoke all on function public.queue_due_email_reminders() from public, anon, authenticated;
grant execute on function public.queue_due_line_reminders() to service_role;
grant execute on function public.queue_due_email_reminders() to service_role;
notify pgrst, 'reload schema';
commit;
