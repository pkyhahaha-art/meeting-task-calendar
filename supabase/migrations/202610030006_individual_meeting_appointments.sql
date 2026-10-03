begin;

-- Qualify the requested email when checking base guests. An unqualified "email"
-- inside that subquery resolves to the guest column and suppresses new attendees.
create or replace function public.update_meeting_occurrence_details(
  target_event_id uuid,target_occurrence_start timestamptz,target_description text,
  target_location text,target_guest_emails text[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences; desired_emails text[]; override_data jsonb;
  description_text text:=btrim(coalesce(target_description,'')); location_text text:=btrim(coalesce(target_location,''));
begin
  if auth.uid() is null or not public.is_active_user() or not public.can_manage_event(target_event_id) then
    raise exception 'only the owner or Admin can update this appointment' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id for update;
  if not found or meeting.recurrence_rule is null or meeting.status<>'scheduled' or meeting.deleted_at is not null then
    raise exception 'a scheduled recurring Meeting is required';
  end if;
  select * into appointment from public.event_occurrences where event_id=target_event_id
    and occurrence_key=target_occurrence_start for update;
  if not found or appointment.start_datetime<=now() or appointment.status<>'scheduled' then
    raise exception 'a future scheduled appointment is required';
  end if;
  select coalesce(array_agg(email),'{}'::text[]) into desired_emails from (
    select distinct lower(btrim(value)) email from unnest(target_guest_emails) value where btrim(value)<>''
  ) normalized;
  if cardinality(desired_emails)>100 or exists(select 1 from unnest(desired_emails) email
    where email !~ '^[^@[:space:]]+@gmail[.]com$') then raise exception 'invalid attendee Gmail addresses'; end if;
  override_data:=appointment.override_payload;
  if description_text is not distinct from meeting.description then override_data:=override_data-'description';
  else override_data:=override_data||jsonb_build_object('description',description_text); end if;
  if location_text is not distinct from meeting.location then override_data:=override_data-'location';
  else override_data:=override_data||jsonb_build_object('location',location_text); end if;
  update public.event_occurrences set override_payload=override_data where id=appointment.id;
  delete from public.event_occurrence_guest_exclusions where occurrence_id=appointment.id;
  insert into public.event_occurrence_guest_exclusions(occurrence_id,email)
    select appointment.id,lower(btrim(guest.email)) from public.event_guests guest
    where guest.event_id=meeting.id and guest.occurrence_id is null and guest.revoked_at is null
      and not(lower(btrim(guest.email))=any(desired_emails));
  delete from public.event_guests guest where guest.occurrence_id=appointment.id and guest.event_id=meeting.id
    and not(lower(btrim(guest.email))=any(desired_emails));
  update public.event_guests guest set revoked_at=null where guest.occurrence_id=appointment.id and guest.event_id=meeting.id
    and lower(btrim(guest.email))=any(desired_emails);
  insert into public.event_guests(event_id,occurrence_id,email)
    select meeting.id,appointment.id,wanted.email from unnest(desired_emails) wanted(email)
    where not exists(select 1 from public.event_guests guest where guest.event_id=meeting.id
      and guest.occurrence_id is null and guest.revoked_at is null and lower(btrim(guest.email))=wanted.email)
    on conflict(event_id,occurrence_id,email) where occurrence_id is not null do update set revoked_at=null;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MEETING_OCCURRENCE_UPDATED','event_occurrence',appointment.id::text,
      jsonb_build_object('event_id',meeting.id,'start_datetime',appointment.start_datetime));
  return appointment.id;
end;
$$;
revoke all on function public.update_meeting_occurrence_details(uuid,timestamptz,text,text,text[]) from public,anon;
grant execute on function public.update_meeting_occurrence_details(uuid,timestamptz,text,text,text[]) to authenticated;

-- Return only availability, never another employee's device or subscription keys.
create or replace function public.meeting_mobile_recipients_available(
  target_guest_emails text[], target_event_id uuid default null
) returns boolean language plpgsql security definer stable set search_path='' as $$
declare creator uuid := auth.uid();
begin
  if creator is null or not public.is_active_user() then return false; end if;
  if cardinality(target_guest_emails)>100 then raise exception 'too many attendees'; end if;
  if target_event_id is not null then
    if not public.can_read_event(target_event_id) then return false; end if;
    select owner_user_id into creator from public.events where id=target_event_id;
  end if;
  return exists (
    select 1 from public.profiles p join public.mobile_push_subscriptions d on d.user_id=p.id
    where p.status='active' and d.endpoint like 'https://%'
      and (p.id=creator or (
        lower(btrim(p.email)) in (select lower(btrim(value)) from unnest(target_guest_emails) value
          where lower(btrim(value)) ~ '^[^@[:space:]]+@gmail[.]com$')
        and not exists(select 1 from public.profiles other where other.id<>p.id and other.status='active'
          and lower(btrim(other.email))=lower(btrim(p.email)))
      ))
  );
end;
$$;
revoke all on function public.meeting_mobile_recipients_available(text[],uuid) from public,anon;
grant execute on function public.meeting_mobile_recipients_available(text[],uuid) to authenticated;

create or replace function public.cancel_meeting_occurrence(target_event_id uuid,target_occurrence_start timestamptz)
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
  return appointment.id;
end;
$$;
revoke all on function public.cancel_meeting_occurrence(uuid,timestamptz) from public,anon;
grant execute on function public.cancel_meeting_occurrence(uuid,timestamptz) to authenticated;

-- Atomically detach one appointment, preserving duration, recipients and reminder
-- offsets. A repeated request returns the same new Meeting instead of duplicating it.
create or replace function public.detach_meeting_occurrence(
  target_event_id uuid,target_occurrence_start timestamptz,target_new_start timestamptz,
  target_description text,target_location text,target_guest_emails text[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences; new_id uuid; desired_emails text[];
  payload jsonb; owner_email text; recipient text;
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
  perform public.cancel_meeting_occurrence(meeting.id,appointment.occurrence_key);
  update public.event_occurrences set override_payload=override_payload||jsonb_build_object('moved_event_id',new_id)
    where id=appointment.id;
  update public.events set suppress_guest_notifications=false where id=new_id;
  payload:=jsonb_build_object('entity','meeting','id',new_id,'title',meeting.title,'description',target_description,
    'start_datetime',target_new_start,'end_datetime',case when appointment.end_datetime is null then null
      else target_new_start+(appointment.end_datetime-appointment.start_datetime) end,'location',target_location,'status','scheduled');
  if meeting.email_notifications_enabled then
    select email into owner_email from public.profiles where id=meeting.owner_user_id;
    perform public.queue_notification(new_id,null,'owner',owner_email,'meeting_created',payload);
  end if;
  if meeting.initial_notification_requested_at is not null and meeting.email_notifications_enabled then
    update public.events set initial_notification_requested_at=now() where id=new_id;
    foreach recipient in array desired_emails loop
      perform public.queue_notification(new_id,null,'guest',recipient,'meeting_guest_added',payload);
    end loop;
  end if;
  if meeting.mobile_notifications_enabled then perform public.queue_meeting_mobile_notification(new_id,true); end if;
  return new_id;
end;
$$;
revoke all on function public.detach_meeting_occurrence(uuid,timestamptz,timestamptz,text,text,text[]) from public,anon;
grant execute on function public.detach_meeting_occurrence(uuid,timestamptz,timestamptz,text,text,text[]) to authenticated;
-- Editing a series must not re-create reminders for individually cancelled dates,
-- including the first appointment whose template has a null occurrence_id.
create or replace function public.skip_cancelled_meeting_appointment_reminder()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('scheduled','processing') and exists (
    select 1 from public.event_occurrences o join public.events e on e.id=o.event_id
    where o.event_id=new.event_id and o.status in ('cancelled','deleted')
      and (o.override_payload->>'cancelled_individually'='true' or o.status='deleted')
      and (o.id=new.occurrence_id or (new.occurrence_id is null and o.occurrence_key=e.start_datetime))
  ) then new.status:='cancelled'; end if;
  return new;
end;
$$;
revoke all on function public.skip_cancelled_meeting_appointment_reminder() from public,anon,authenticated;
drop trigger if exists skip_cancelled_meeting_appointment_reminder on public.reminders;
create trigger skip_cancelled_meeting_appointment_reminder before insert or update on public.reminders
  for each row execute function public.skip_cancelled_meeting_appointment_reminder();
notify pgrst,'reload schema';
commit;
