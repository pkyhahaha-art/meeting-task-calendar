begin;

-- A Gmail address authorizes Push only when it unambiguously belongs to one
-- active employee. Respect per-occurrence guest additions and exclusions.
create or replace function public.meeting_mobile_guest_users(target_event_id uuid, target_occurrence_id uuid)
returns table(user_id uuid) language sql security definer stable set search_path = '' as $$
  select distinct profile.id
  from public.occurrence_guest_emails(target_event_id, target_occurrence_id) guest
  join public.profiles profile on lower(btrim(profile.email)) = guest.email and profile.status = 'active'
  where not exists (
    select 1 from public.profiles duplicate
    where duplicate.id <> profile.id and duplicate.status = 'active'
      and lower(btrim(duplicate.email)) = lower(btrim(profile.email))
  );
$$;
revoke all on function public.meeting_mobile_guest_users(uuid,uuid) from public, anon, authenticated;
grant execute on function public.meeting_mobile_guest_users(uuid,uuid) to service_role;

-- The creator opts in for the Meeting. Its invited employees then receive
-- their own Push, while external Gmail addresses still use email only.
create or replace function public.queue_meeting_mobile_notification(target_event_id uuid, target_initial boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare meeting public.events; queued integer; template text; version_key text;
begin
  if not public.can_manage_event(target_event_id) then
    raise exception 'only the active Meeting creator may notify their devices' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id and deleted_at is null and status='scheduled';
  if not found or not meeting.mobile_notifications_enabled then return 0; end if;
  template := case when target_initial then 'meeting_created' else 'meeting_updated' end;
  version_key := case when target_initial then 'initial' else meeting.notification_requested_at::text end;
  if version_key is null then return 0; end if;

  with recipients as (
    select meeting.owner_user_id as user_id
    union
    select guest.user_id from public.meeting_mobile_guest_users(meeting.id, null::uuid) guest
  )
  insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload)
  select meeting.id,case when recipient.user_id=meeting.owner_user_id then 'owner' else 'registered_user' end,
    device.id::text,'push',
    concat('meeting-mobile:',meeting.id,':',template,':',version_key,':',device.id),now(),template,
    jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
      'description',meeting.description,'start_datetime',meeting.start_datetime,
      'end_datetime',meeting.end_datetime,'location',meeting.location,'push_user_id',recipient.user_id)
  from recipients recipient
  join public.profiles profile on profile.id=recipient.user_id and profile.status='active'
  join public.mobile_push_subscriptions device on device.user_id=recipient.user_id and device.endpoint like 'https://%'
  on conflict(idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke all on function public.queue_meeting_mobile_notification(uuid,boolean) from public,anon;
grant execute on function public.queue_meeting_mobile_notification(uuid,boolean) to authenticated;

-- Keep the existing Task and LINE behavior. Queue Meeting attendee Push before
-- email processing completes the shared reminder row.
create or replace function public.queue_due_line_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record; member record; line_id text; queued integer := 0; message jsonb;
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
    message := jsonb_build_object('entity', 'task', 'id', item.task_id, 'title', item.title,
      'description', item.description, 'due_date', item.due_date, 'due_time', item.due_time);
    for member in select profile.id from public.task_internal_recipients tir
      join public.profiles profile on profile.id = tir.user_id
      where tir.task_id = item.task_id and profile.status = 'active'
    loop
      perform public.queue_push_reminder_delivery(item.id, null, item.task_id, 'task_assignee', member.id, 'task_reminder', message, item.scheduled_at);
      select line_user_id into line_id from public.line_connections where user_id = member.id and disconnected_at is null;
      perform public.queue_line_delivery(item.id, null, item.task_id, 'task_assignee', line_id, 'task_reminder', message, item.scheduled_at);
    end loop;
    if item.reminder_key = 'overdue' then
      perform public.queue_push_reminder_delivery(item.id, null, item.task_id, 'task_creator', item.creator_user_id, 'task_reminder', message, item.scheduled_at);
      select line_user_id into line_id from public.line_connections where user_id = item.creator_user_id and disconnected_at is null;
      perform public.queue_line_delivery(item.id, null, item.task_id, 'task_creator', line_id, 'task_reminder', message, item.scheduled_at);
    end if;
    if not item.channel_email then update public.task_reminders set status = 'completed' where id = item.id; end if;
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;
revoke all on function public.queue_due_line_reminders() from public, anon, authenticated;
grant execute on function public.queue_due_line_reminders() to service_role;
notify pgrst, 'reload schema';
commit;
