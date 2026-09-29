-- Custom Meeting recurrence: RRULE interval/BYDAY support, immediate occurrence
-- materialization, and occurrence-specific reminder payloads.

create function public.create_meeting_event_v2(
  target_title text,
  target_description text,
  target_location text,
  target_affiliation text,
  target_all_day boolean,
  target_start_datetime timestamptz,
  target_end_datetime timestamptz,
  target_recurrence_rule text,
  target_recurrence_until timestamptz,
  target_recurrence_count integer
)
returns public.events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_event public.events;
begin
  if not public.is_active_user() then
    raise exception 'active employee account required' using errcode = '42501';
  end if;
  if target_recurrence_rule is null and (target_recurrence_until is not null or target_recurrence_count is not null) then
    raise exception 'a recurrence end requires a recurrence rule';
  end if;
  if target_recurrence_until is not null and target_recurrence_until < target_start_datetime then
    raise exception 'recurrence end cannot be before the Meeting start';
  end if;

  insert into public.events (
    owner_user_id, title, description, location, affiliation, all_day,
    start_datetime, end_datetime, recurrence_rule, recurrence_until, recurrence_count
  ) values (
    auth.uid(), target_title, target_description, target_location,
    coalesce(target_affiliation, ''), target_all_day, target_start_datetime,
    target_end_datetime, target_recurrence_rule, target_recurrence_until, target_recurrence_count
  ) returning * into created_event;

  return created_event;
end;
$$;

create or replace function public.materialize_event_occurrences_for_event(target_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  candidate timestamptz;
  occurrence_count integer := 0;
  frequency text;
  interval_text text;
  every_interval integer := 1;
  recurrence_days text[];
  generated_keys timestamptz[] := '{}'::timestamptz[];
  horizon_at timestamptz := now() + interval '12 months';
  end_at timestamptz;
  start_local_date date;
begin
  select * into event_row from public.events where id = target_event_id;
  if not found then return 0; end if;

  if event_row.recurrence_rule is null or event_row.status <> 'scheduled' or event_row.deleted_at is not null then
    delete from public.event_occurrences occurrence
      where occurrence.event_id = target_event_id and occurrence.occurrence_key > now();
    return 0;
  end if;

  frequency := substring(event_row.recurrence_rule from 'FREQ=([A-Z]+)');
  if frequency not in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') then return 0; end if;
  interval_text := substring(event_row.recurrence_rule from 'INTERVAL=([0-9]+)');
  every_interval := case when interval_text ~ '^[1-9][0-9]*$' then interval_text::integer else 1 end;
  recurrence_days := string_to_array(nullif(substring(event_row.recurrence_rule from 'BYDAY=([A-Z,]+)'), ''), ',');
  start_local_date := (event_row.start_datetime at time zone event_row.timezone)::date;
  if frequency = 'WEEKLY' and coalesce(cardinality(recurrence_days), 0) = 0 then
    recurrence_days := array[(array['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])[extract(isodow from start_local_date)::integer]];
  end if;
  end_at := least(coalesce(event_row.recurrence_until, horizon_at), horizon_at);

  for candidate in
    with days as (
      select value as occurrence_at, (value at time zone event_row.timezone)::date as local_date
      from generate_series(event_row.start_datetime, end_at, interval '1 day') value
    ), matching as (
      select occurrence_at, row_number() over (order by occurrence_at) as recurrence_number
      from days
      where (frequency = 'DAILY' and ((local_date - start_local_date) % every_interval = 0))
        or (frequency = 'WEEKLY'
          and (((local_date - start_local_date) / 7) % every_interval = 0)
          and (array['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])[extract(isodow from local_date)::integer] = any(recurrence_days))
        or (frequency = 'MONTHLY'
          and extract(day from local_date) = extract(day from start_local_date)
          and (((extract(year from local_date)::integer - extract(year from start_local_date)::integer) * 12
            + extract(month from local_date)::integer - extract(month from start_local_date)::integer) % every_interval = 0))
        or (frequency = 'YEARLY'
          and extract(month from local_date) = extract(month from start_local_date)
          and extract(day from local_date) = extract(day from start_local_date)
          and ((extract(year from local_date)::integer - extract(year from start_local_date)::integer) % every_interval = 0))
    )
    select occurrence_at from matching
      where event_row.recurrence_count is null or recurrence_number <= event_row.recurrence_count
  loop
    generated_keys := array_append(generated_keys, candidate);
    insert into public.event_occurrences(event_id, occurrence_key, start_datetime, end_datetime, status)
    values (
      event_row.id, candidate, candidate,
      case when event_row.end_datetime is null then null else candidate + (event_row.end_datetime - event_row.start_datetime) end,
      'scheduled'
    ) on conflict (event_id, occurrence_key) do update set
      start_datetime = excluded.start_datetime,
      end_datetime = excluded.end_datetime,
      updated_at = now();
    occurrence_count := occurrence_count + 1;
  end loop;

  delete from public.event_occurrences occurrence
    where occurrence.event_id = event_row.id
      and occurrence.occurrence_key > now()
      and occurrence.occurrence_key <= horizon_at
      and not (occurrence.occurrence_key = any(generated_keys));

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
  where occurrence.event_id = event_row.id
    and occurrence.occurrence_key > event_row.start_datetime
  on conflict (occurrence_id, offset_value, offset_unit) where occurrence_id is not null
  do update set
    scheduled_at = excluded.scheduled_at,
    channel_email = excluded.channel_email,
    channel_line = excluded.channel_line,
    updated_at = now()
  where public.reminders.status = 'scheduled';

  return occurrence_count;
end;
$$;

create or replace function public.materialize_event_occurrences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  occurrence_count integer := 0;
begin
  for event_id in
    select id from public.events
    where recurrence_rule is not null and status = 'scheduled' and deleted_at is null
  loop
    occurrence_count := occurrence_count + public.materialize_event_occurrences_for_event(event_id);
  end loop;
  return occurrence_count;
end;
$$;

create function public.refresh_meeting_occurrences(target_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_event(target_event_id) then
    raise exception 'only the Meeting creator may refresh occurrences' using errcode = '42501';
  end if;
  return public.materialize_event_occurrences_for_event(target_event_id);
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

create or replace function public.queue_due_email_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  event_reminder record; task_reminder record; recipient record;
  creator_email text; overdue_day integer; delivery_scheduled_at timestamptz;
  queued_count integer := 0;
begin
  for event_reminder in
    select r.id, r.scheduled_at, e.id as event_id, e.owner_user_id, e.title, e.description,
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
    for recipient in select email from public.event_guests
      where event_id = event_reminder.event_id and revoked_at is null loop
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
    for recipient in select profile.email from public.task_internal_recipients member
      join public.profiles profile on profile.id = member.user_id
      where member.task_id = task_reminder.task_id and profile.status = 'active' loop
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'task_assignee', recipient.email, 'task_reminder',
        jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
          'title', task_reminder.title, 'description', task_reminder.description,
          'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time), delivery_scheduled_at);
    end loop;
    for recipient in select email from public.task_external_recipients
      where task_id = task_reminder.task_id loop
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

revoke all on function public.create_meeting_event_v2(text, text, text, text, boolean, timestamptz, timestamptz, text, timestamptz, integer) from public, anon;
revoke all on function public.materialize_event_occurrences_for_event(uuid) from public;
revoke all on function public.refresh_meeting_occurrences(uuid) from public, anon;
revoke all on function public.materialize_event_occurrences() from public;
revoke all on function public.queue_due_line_reminders() from public;
revoke all on function public.queue_due_email_reminders() from public;
grant execute on function public.create_meeting_event_v2(text, text, text, text, boolean, timestamptz, timestamptz, text, timestamptz, integer) to authenticated;
grant execute on function public.refresh_meeting_occurrences(uuid) to authenticated;
grant execute on function public.materialize_event_occurrences_for_event(uuid) to service_role;
grant execute on function public.materialize_event_occurrences() to service_role;
grant execute on function public.queue_due_line_reminders() to service_role;
grant execute on function public.queue_due_email_reminders() to service_role;
