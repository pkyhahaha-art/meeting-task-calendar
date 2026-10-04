begin;
-- Keep the start as occurrence 1. Weekly intervals share the Monday-to-Sunday
-- calendar week containing that start, rather than separate rolling day blocks.
create or replace function public.materialize_event_occurrences_for_event(target_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
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
  start_week_date date;
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
  start_week_date := start_local_date - (extract(isodow from start_local_date)::integer - 1);
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
      where occurrence_at = event_row.start_datetime
        or (frequency = 'DAILY' and ((local_date - start_local_date) % every_interval = 0))
        or (frequency = 'WEEKLY'
          and (((local_date - start_week_date) / 7) % every_interval = 0)
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
    -- Restore an automatically excluded future appointment if the series includes
    -- it again. Explicit cancellations and previously delivered reminders stay intact.
    update public.reminders r set status='scheduled'
      from public.event_occurrences occurrence
      where r.occurrence_id=occurrence.id and occurrence.event_id=event_row.id
        and occurrence.occurrence_key=candidate and occurrence.override_payload->>'recurrence_removed'='true'
        and r.status='cancelled' and r.scheduled_at>now();
    update public.notification_deliveries d set status='queued',error_code=null,error_message=null
      from public.reminders r join public.event_occurrences occurrence on occurrence.id=r.occurrence_id
      where d.reminder_id=r.id and occurrence.event_id=event_row.id and occurrence.occurrence_key=candidate
        and occurrence.override_payload->>'recurrence_removed'='true' and d.status='skipped'
        and d.error_code='recurrence_removed' and d.scheduled_at>now();
    generated_keys := array_append(generated_keys, candidate);
    insert into public.event_occurrences(event_id, occurrence_key, start_datetime, end_datetime, status)
    values(event_row.id,candidate,candidate,
      case when event_row.end_datetime is null then null else candidate+(event_row.end_datetime-event_row.start_datetime) end,'scheduled')
    on conflict(event_id,occurrence_key) do update set
      start_datetime=excluded.start_datetime,end_datetime=excluded.end_datetime,
      status=case when public.event_occurrences.override_payload->>'recurrence_removed'='true'
        then 'scheduled' else public.event_occurrences.status end,
      override_payload=public.event_occurrences.override_payload-'recurrence_removed',updated_at=now();
    occurrence_count := occurrence_count+1;
  end loop;

  -- Retain notes, guest overrides and attachments on appointments removed by a
  -- count change, so increasing the count can restore the same appointment.
  update public.event_occurrences occurrence
    set status='cancelled',override_payload=occurrence.override_payload||'{"recurrence_removed":true}'::jsonb
    where occurrence.event_id=event_row.id and occurrence.status='scheduled'
      and occurrence.occurrence_key>now() and occurrence.occurrence_key<=horizon_at
      and not(occurrence.occurrence_key=any(generated_keys));
  update public.notification_deliveries d
    set status='skipped',error_code='recurrence_removed',error_message='Appointment is outside the recurrence series'
    from public.reminders r join public.event_occurrences occurrence on occurrence.id=r.occurrence_id
    where d.reminder_id=r.id and occurrence.event_id=event_row.id
      and occurrence.override_payload->>'recurrence_removed'='true' and d.status in ('queued','retry');
  update public.reminders r set status='cancelled'
    from public.event_occurrences occurrence
    where r.occurrence_id=occurrence.id and occurrence.event_id=event_row.id
      and occurrence.override_payload->>'recurrence_removed'='true' and r.status='scheduled';

  insert into public.reminders(event_id,occurrence_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line,status)
  select template.event_id,occurrence.id,template.offset_value,template.offset_unit,
    occurrence.start_datetime-case template.offset_unit
      when 'minute' then make_interval(mins=>template.offset_value)
      when 'hour' then make_interval(hours=>template.offset_value)
      when 'day' then make_interval(days=>template.offset_value)
      when 'week' then make_interval(days=>template.offset_value*7)
      when 'month' then make_interval(months=>template.offset_value)
    end,template.channel_email,template.channel_line,'scheduled'
  from public.event_occurrences occurrence
  join public.reminders template on template.event_id=occurrence.event_id and template.occurrence_id is null
  where occurrence.event_id=event_row.id and occurrence.status='scheduled' and occurrence.occurrence_key>event_row.start_datetime
  on conflict(occurrence_id,offset_value,offset_unit) where occurrence_id is not null
  do update set scheduled_at=excluded.scheduled_at,channel_email=excluded.channel_email,
    channel_line=excluded.channel_line,updated_at=now() where public.reminders.status='scheduled';
  return occurrence_count;
end;
$$;
-- Function contract and grants remain unchanged. The rollout previews and
-- refreshes affected series separately; applying this file does not modify data.
notify pgrst,'reload schema';
commit;
