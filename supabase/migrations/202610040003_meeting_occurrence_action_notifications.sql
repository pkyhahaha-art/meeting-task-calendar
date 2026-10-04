begin;

-- Action notices use the existing queue and private, deterministic helpers.
-- A move is addressed to the new Meeting's recipients, as before; an ordinary
-- cancellation is addressed to the selected occurrence's current recipients.
create or replace function public.queue_meeting_occurrence_action(
  target_event_id uuid,target_occurrence_id uuid,target_original_start timestamptz,
  target_new_start timestamptz,target_original_event_id uuid,target_original_occurrence_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare meeting public.events; payload jsonb; template text; action_key text;
begin
  select * into meeting from public.events where id=target_event_id;
  if not found then return; end if;
  template:=case when target_new_start is null then 'meeting_occurrence_cancelled' else 'meeting_occurrence_moved' end;
  action_key:=concat('meeting-appointment:',target_original_occurrence_id,':',template);
  payload:=jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
    'occurrence_id',target_occurrence_id,'original_event_id',target_original_event_id,
    'original_occurrence_id',target_original_occurrence_id,'original_occurrence_start',target_original_start,
    'new_occurrence_start',target_new_start,'all_day',meeting.all_day,
    'start_datetime',coalesce(target_new_start,target_original_start),
    'status',case when target_new_start is null then 'cancelled' else 'scheduled' end);

  if meeting.email_notifications_enabled then
    with recipients as (
      select lower(btrim(profile.email)) email from public.profiles profile
        where profile.id=meeting.owner_user_id and profile.status='active'
      union
      select guest.email from public.occurrence_guest_emails(meeting.id,target_occurrence_id) guest
    )
    insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,
      idempotency_key,scheduled_at,template_key,payload)
    select meeting.id,case when recipient.email=lower(btrim(owner_profile.email)) then 'owner' else 'guest' end,
      recipient.email,'email',concat(action_key,':email:',recipient.email),now(),template,payload
    from recipients recipient join public.profiles owner_profile on owner_profile.id=meeting.owner_user_id
    where recipient.email is not null and recipient.email<>''
    on conflict(idempotency_key) do nothing;
  end if;

  if meeting.mobile_notifications_enabled then
    with recipients as (
      select meeting.owner_user_id user_id
      union
      select guest.user_id from public.meeting_mobile_guest_users(meeting.id,target_occurrence_id) guest
    )
    insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,
      idempotency_key,scheduled_at,template_key,payload)
    select meeting.id,case when recipient.user_id=meeting.owner_user_id then 'owner' else 'registered_user' end,
      device.id::text,'push',concat(action_key,':push:',device.id),now(),template,
      payload||jsonb_build_object('push_user_id',recipient.user_id)
    from recipients recipient join public.profiles profile on profile.id=recipient.user_id and profile.status='active'
      join public.mobile_push_subscriptions device on device.user_id=recipient.user_id and device.endpoint like 'https://%'
    on conflict(idempotency_key) do nothing;
  end if;
end;
$$;
revoke all on function public.queue_meeting_occurrence_action(uuid,uuid,timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;

create or replace function public.cancel_meeting_occurrence_internal(target_event_id uuid,target_occurrence_start timestamptz,target_notify boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences;
begin
  if auth.uid() is null or not public.is_active_user() or not public.can_manage_event(target_event_id) then
    raise exception 'only the owner or Admin can cancel this appointment' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id for update;
  if not found or meeting.recurrence_rule is null or meeting.status<>'scheduled' or meeting.deleted_at is not null then
    raise exception 'a scheduled recurring Meeting is required';
  end if;
  select * into appointment from public.event_occurrences
    where event_id=target_event_id and occurrence_key=target_occurrence_start for update;
  if not found or appointment.start_datetime<=now() then raise exception 'a future appointment is required'; end if;
  if appointment.status='cancelled' then return appointment.id; end if;
  if appointment.status<>'scheduled' then raise exception 'a scheduled appointment is required'; end if;
  update public.event_occurrences set status='cancelled',
    override_payload=(override_payload-'recurrence_removed')||'{"cancelled_individually":true}'::jsonb
    where id=appointment.id;
  update public.notification_deliveries d set status='skipped',error_code='appointment_cancelled',
    error_message='This appointment was cancelled individually'
    from public.reminders r where d.reminder_id=r.id and r.event_id=meeting.id
      and (r.occurrence_id=appointment.id or (r.occurrence_id is null and appointment.occurrence_key=meeting.start_datetime))
      and d.status in ('queued','retry');
  update public.reminders set status='cancelled' where event_id=meeting.id
    and (occurrence_id=appointment.id or (occurrence_id is null and appointment.occurrence_key=meeting.start_datetime))
    and status in ('scheduled','processing');
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MEETING_OCCURRENCE_CANCELLED','event_occurrence',appointment.id::text,
      jsonb_build_object('event_id',meeting.id,'start_datetime',appointment.start_datetime));
  if target_notify then
    perform public.queue_meeting_occurrence_action(meeting.id,appointment.id,appointment.start_datetime,null,meeting.id,appointment.id);
  end if;
  return appointment.id;
end;
$$;
revoke all on function public.cancel_meeting_occurrence_internal(uuid,timestamptz,boolean) from public,anon,authenticated;

create or replace function public.cancel_meeting_occurrence(target_event_id uuid,target_occurrence_start timestamptz)
returns uuid language sql security definer set search_path='' as $$
  select public.cancel_meeting_occurrence_internal(target_event_id,target_occurrence_start,true);
$$;
revoke all on function public.cancel_meeting_occurrence(uuid,timestamptz) from public,anon;
grant execute on function public.cancel_meeting_occurrence(uuid,timestamptz) to authenticated;

create or replace function public.detach_meeting_occurrence(
  target_event_id uuid,target_occurrence_start timestamptz,target_new_start timestamptz,
  target_description text,target_location text,target_guest_emails text[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences; new_id uuid; desired_emails text[];

begin
  if auth.uid() is null or not public.is_active_user() or not public.can_manage_event(target_event_id) then
    raise exception 'only the owner or Admin can move this appointment' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id for update;
  if not found or meeting.recurrence_rule is null or meeting.status<>'scheduled' or meeting.deleted_at is not null then
    raise exception 'a scheduled recurring Meeting is required';
  end if;
  select * into appointment from public.event_occurrences where event_id=meeting.id
    and occurrence_key=target_occurrence_start for update;
  if not found then raise exception 'appointment not found'; end if;
  if appointment.override_payload->>'moved_event_id' is not null then
    return (appointment.override_payload->>'moved_event_id')::uuid;
  end if;
  if appointment.status<>'scheduled' or appointment.start_datetime<=now() or target_new_start<=now()
    or target_new_start is null or target_new_start=appointment.start_datetime then
    raise exception 'two distinct future appointment dates are required';
  end if;
  select coalesce(array_agg(email),'{}'::text[]) into desired_emails from (
    select distinct lower(btrim(value)) email from unnest(target_guest_emails) value where btrim(value)<>''
  ) normalized;
  if cardinality(desired_emails)>100 or exists(select 1 from unnest(desired_emails) email
    where email !~ '^[^@[:space:]]+@gmail[.]com$') then raise exception 'invalid attendee Gmail addresses'; end if;
  insert into public.events(owner_user_id,title,description,location,affiliation,start_datetime,end_datetime,
    all_day,timezone,suppress_guest_notifications,email_notifications_enabled,mobile_notifications_enabled)
  values(meeting.owner_user_id,meeting.title,btrim(coalesce(target_description,'')),btrim(coalesce(target_location,'')),
    meeting.affiliation,target_new_start,
    case when appointment.end_datetime is null then null else target_new_start+(appointment.end_datetime-appointment.start_datetime) end,
    meeting.all_day,meeting.timezone,true,meeting.email_notifications_enabled,meeting.mobile_notifications_enabled)
  returning id into new_id;
  insert into public.event_guests(event_id,email) select new_id,email from unnest(desired_emails) email;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    select new_id,r.offset_value,r.offset_unit,
      target_new_start-case r.offset_unit when 'minute' then make_interval(mins=>r.offset_value)
        when 'hour' then make_interval(hours=>r.offset_value) when 'day' then make_interval(days=>r.offset_value)
        when 'week' then make_interval(days=>r.offset_value*7) when 'month' then make_interval(months=>r.offset_value) end,
      r.channel_email,r.channel_line from public.reminders r where r.event_id=meeting.id
      and (r.occurrence_id=appointment.id or (r.occurrence_id is null and appointment.occurrence_key=meeting.start_datetime));
  perform public.cancel_meeting_occurrence_internal(meeting.id,appointment.occurrence_key,false);
  update public.event_occurrences set override_payload=override_payload||jsonb_build_object('moved_event_id',new_id)
    where id=appointment.id;
  update public.events set suppress_guest_notifications=false where id=new_id;
  if meeting.initial_notification_requested_at is not null and meeting.email_notifications_enabled then
    update public.events set initial_notification_requested_at=now() where id=new_id;
  end if;
  perform public.queue_meeting_occurrence_action(new_id,null,appointment.start_datetime,target_new_start,meeting.id,appointment.id);
  return new_id;
end;
$$;
revoke all on function public.detach_meeting_occurrence(uuid,timestamptz,timestamptz,text,text,text[]) from public,anon;
grant execute on function public.detach_meeting_occurrence(uuid,timestamptz,timestamptz,text,text,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
