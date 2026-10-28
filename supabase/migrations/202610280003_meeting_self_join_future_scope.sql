-- Nullable cutoff applies only to new self-joined recurring series.
-- Existing organizer-managed and legacy rows remain unrestricted (NULL).
begin;
alter table public.event_guests add column if not exists self_join_from timestamptz;
create or replace function public.occurrence_guest_emails(target_event_id uuid, target_occurrence_id uuid)
returns table(email text)
language sql
security definer
stable
set search_path = ''
as $$
  with base_guests as (
    select lower(guest.email) as email
    from public.event_guests guest
    where guest.event_id = target_event_id
      and guest.occurrence_id is null
      and guest.revoked_at is null
      and (guest.self_join_from is null or guest.self_join_from <= coalesce(
        (select occurrence.start_datetime from public.event_occurrences occurrence
          where occurrence.id = target_occurrence_id and occurrence.event_id = target_event_id),
        (select event.start_datetime from public.events event where event.id = target_event_id)))
      and not exists (
        select 1 from public.event_occurrence_guest_exclusions exclusion
        where exclusion.occurrence_id = target_occurrence_id
          and lower(exclusion.email) = lower(guest.email)
      )
  ), occurrence_guests as (
    select lower(guest.email) as email
    from public.event_guests guest
    where guest.event_id = target_event_id
      and guest.occurrence_id = target_occurrence_id
      and guest.revoked_at is null
  )
  select email from base_guests
  union
  select email from occurrence_guests;
$$;


create or replace function public.join_meeting_as_attendee(
  target_event_id uuid,
  target_occurrence_start timestamptz,
  target_scope text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  meeting public.events%rowtype;
  appointment public.event_occurrences%rowtype;
  attendee_email text;
begin
  if auth.uid() is null or target_event_id is null or target_occurrence_start is null or target_scope is null
    or target_scope not in ('occurrence', 'series') then
    raise exception 'invalid Meeting join request' using errcode = '22023';
  end if;

  select lower(btrim(profile.email)) into attendee_email
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = auth.uid() and profile.status = 'active'
    and profile.email_verified_at is not null and account.email_confirmed_at is not null
    and lower(btrim(account.email)) = lower(btrim(profile.email));
  if attendee_email is null then
    raise exception 'a verified active employee account is required' using errcode = '42501';
  end if;

  select * into meeting from public.events where id = target_event_id for update;
  if not found or meeting.deleted_at is not null or meeting.status <> 'scheduled' then
    raise exception 'Meeting is unavailable' using errcode = 'P0002';
  end if;
  if meeting.owner_user_id = auth.uid() then return false; end if;

  if meeting.recurrence_rule is null then
    if target_occurrence_start <> meeting.start_datetime then
      raise exception 'a future scheduled Meeting is required' using errcode = '22023';
    end if;
    if meeting.start_datetime <= now() then
      raise exception 'meeting_join_start_passed' using errcode = '22023';
    end if;
  else
    select * into appointment from public.event_occurrences
    where event_id = target_event_id and start_datetime = target_occurrence_start
    for update;
    if not found or appointment.status <> 'scheduled' then
      raise exception 'a future scheduled appointment is required' using errcode = '22023';
    end if;
    if appointment.start_datetime <= now() then
      raise exception 'meeting_join_start_passed' using errcode = '22023';
    end if;
  end if;

  -- An explicit removal by the Meeting owner remains authoritative.
  if exists (
    select 1 from public.event_guests guest
    where guest.event_id = target_event_id and lower(btrim(guest.email)) = attendee_email
      and guest.revoked_at is not null
      and (guest.occurrence_id is null
        or (target_scope='series' and exists(select 1 from public.event_occurrences occurrence
          where occurrence.id=guest.occurrence_id and occurrence.event_id=target_event_id and occurrence.start_datetime>=target_occurrence_start))
        or (target_scope='occurrence' and guest.occurrence_id=appointment.id))
  ) or exists (
    select 1 from public.event_occurrence_guest_exclusions exclusion
    join public.event_occurrences occurrence on occurrence.id = exclusion.occurrence_id
    where occurrence.event_id = target_event_id and lower(btrim(exclusion.email)) = attendee_email
      and ((target_scope='series' and occurrence.start_datetime>=target_occurrence_start)
        or (target_scope='occurrence' and exclusion.occurrence_id=appointment.id))
  ) then
    raise exception 'the Meeting organizer removed this attendee; contact the organizer' using errcode = '42501';
  end if;

  if target_scope = 'occurrence' and meeting.recurrence_rule is not null then
    if exists (select 1 from public.occurrence_guest_emails(target_event_id, appointment.id) guest
      where guest.email = attendee_email) then return false; end if;
    insert into public.event_guests(event_id, occurrence_id, email)
    values (target_event_id, appointment.id, attendee_email)
    on conflict (event_id, occurrence_id, email) where occurrence_id is not null do nothing;
  else
    if exists (select 1 from public.event_guests guest
      where guest.event_id = target_event_id and guest.occurrence_id is null
        and lower(btrim(guest.email)) = attendee_email and guest.revoked_at is null) then
      update public.event_guests guest set self_join_from = target_occurrence_start
        where guest.event_id = target_event_id and guest.occurrence_id is null
          and lower(btrim(guest.email)) = attendee_email and guest.revoked_at is null
          and guest.self_join_from > target_occurrence_start and meeting.recurrence_rule is not null;
      if not found then return false; end if;
    else
      insert into public.event_guests(event_id, email, self_join_from)
      values (target_event_id, attendee_email, case when meeting.recurrence_rule is not null then target_occurrence_start else null end)
      on conflict (event_id, email) where occurrence_id is null do nothing;
    end if;
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'MEETING_SELF_JOINED', 'event', target_event_id::text,
    jsonb_build_object('scope', target_scope, 'occurrence_start', target_occurrence_start));
  return true;
end;
$$;

revoke all on function public.join_meeting_as_attendee(uuid,timestamptz,text) from public, anon;
grant execute on function public.join_meeting_as_attendee(uuid,timestamptz,text) to authenticated;

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
      and guest.occurrence_id is null and guest.revoked_at is null and lower(btrim(guest.email))=wanted.email
      and (guest.self_join_from is null or guest.self_join_from <= appointment.start_datetime))
    on conflict(event_id,occurrence_id,email) where occurrence_id is not null do update set revoked_at=null;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MEETING_OCCURRENCE_UPDATED','event_occurrence',appointment.id::text,
      jsonb_build_object('event_id',meeting.id,'start_datetime',appointment.start_datetime));
  return appointment.id;
end;
$$;
revoke all on function public.update_meeting_occurrence_details(uuid,timestamptz,text,text,text[]) from public,anon;
grant execute on function public.update_meeting_occurrence_details(uuid,timestamptz,text,text,text[]) to authenticated;


create or replace function public.queue_event_email_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_email text; template text; payload jsonb; guest_row record; scoped_payload jsonb; appointment public.event_occurrences;
begin
  if tg_op = 'INSERT' then return new; end if;
  if new.notification_requested_at is not distinct from old.notification_requested_at
    and new.status is not distinct from old.status then return new; end if;
  template := case when new.status = 'cancelled' then 'meeting_cancelled' else 'meeting_updated' end;
  payload := jsonb_build_object('entity', 'meeting', 'id', new.id, 'title', new.title,
    'start_datetime', new.start_datetime, 'end_datetime', new.end_datetime,
    'location', new.location, 'status', new.status);
  select email into owner_email from public.profiles where id = new.owner_user_id;
  perform public.queue_notification(new.id, null, 'owner', owner_email, template, payload);
  for guest_row in select email,self_join_from from public.event_guests
    where event_id = new.id and occurrence_id is null and revoked_at is null loop
    scoped_payload := payload;
    if guest_row.self_join_from is not null then
      select * into appointment from public.event_occurrences where event_id=new.id
        and start_datetime>=guest_row.self_join_from and start_datetime>now()
        and (status='scheduled' or template='meeting_cancelled')
        and exists(select 1 from public.occurrence_guest_emails(new.id,public.event_occurrences.id) current_guest
          where current_guest.email=lower(btrim(guest_row.email))) order by start_datetime limit 1;
      if not found then continue; end if;
      scoped_payload := payload || jsonb_build_object('occurrence_id',appointment.id,
        'start_datetime',appointment.start_datetime,'end_datetime',appointment.end_datetime);
    end if;
    perform public.queue_notification(new.id, null, 'guest', guest_row.email, template, scoped_payload);
  end loop;
  return new;
end;
$$;

create or replace function public.queue_event_guest_email_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_row public.events; appointment public.event_occurrences; payload jsonb;
begin
  if new.occurrence_id is not null or new.revoked_at is not null then return new; end if;
  select * into event_row from public.events where id = new.event_id;
  if event_row.id is not null and not event_row.suppress_guest_notifications
    and event_row.initial_notification_requested_at is not null then
    payload := jsonb_build_object('entity','meeting','id',event_row.id,'title',event_row.title,
      'start_datetime',event_row.start_datetime,'end_datetime',event_row.end_datetime,
      'location',event_row.location,'status',event_row.status);
    if new.self_join_from is not null then
      select * into appointment from public.event_occurrences where event_id=new.event_id
        and start_datetime>=new.self_join_from and status='scheduled' order by start_datetime limit 1;
      if not found then return new; end if;
      payload := payload || jsonb_build_object('occurrence_id',appointment.id,
        'start_datetime',appointment.start_datetime,'end_datetime',appointment.end_datetime);
    end if;
    perform public.queue_notification(event_row.id,null,'guest',new.email,'meeting_guest_added',payload);
  end if;
  return new;
end;
$$;


create or replace function public.queue_meeting_initial_notifications(target_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare event_row public.events; owner_email text; guest_row record; payload jsonb; notification_count integer := 0; scoped_payload jsonb; appointment public.event_occurrences;
begin
  if auth.uid() is null or not public.is_active_user() or not exists(
    select 1 from public.events e where e.id=target_event_id and e.owner_user_id=auth.uid()) then
    raise exception 'only the Meeting creator may send an initial invitation' using errcode = '42501';
  end if;
  update public.events set initial_notification_requested_at = now()
    where id = target_event_id and initial_notification_requested_at is null
    returning * into event_row;
  if not found then return 0; end if;
  payload := jsonb_build_object('entity', 'meeting', 'id', event_row.id, 'title', event_row.title,
    'description', event_row.description, 'start_datetime', event_row.start_datetime,
    'end_datetime', event_row.end_datetime, 'location', event_row.location, 'status', event_row.status);
  select email into owner_email from public.profiles where id = event_row.owner_user_id;
  perform public.queue_notification(event_row.id, null, 'owner', owner_email, 'meeting_created', payload);
  notification_count := 1;
  for guest_row in select email,self_join_from from public.event_guests
    where event_id = event_row.id and occurrence_id is null and revoked_at is null loop
    scoped_payload:=payload;
    if guest_row.self_join_from is not null then
      select * into appointment from public.event_occurrences occurrence where occurrence.event_id=event_row.id
        and occurrence.start_datetime>=guest_row.self_join_from and occurrence.start_datetime>now() and occurrence.status='scheduled'
        and exists(select 1 from public.occurrence_guest_emails(event_row.id,occurrence.id) current_guest
          where current_guest.email=lower(btrim(guest_row.email))) order by occurrence.start_datetime limit 1;
      if not found then continue; end if;
      scoped_payload:=payload||jsonb_build_object('occurrence_id',appointment.id,'start_datetime',appointment.start_datetime,'end_datetime',appointment.end_datetime);
    end if;
    perform public.queue_notification(event_row.id, null, 'guest', guest_row.email, 'meeting_guest_added', scoped_payload);
    notification_count := notification_count + 1;
  end loop;
  return notification_count;
end;
$$;


create or replace function public.queue_meeting_mobile_notification(target_event_id uuid, target_initial boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare meeting public.events; queued integer; template text; version_key text;
begin
  if not public.can_manage_event(target_event_id) then
    raise exception 'only the active Meeting creator may notify their devices' using errcode='42501';
  end if;
  if target_initial and not exists(select 1 from public.events e where e.id=target_event_id and e.owner_user_id=auth.uid()) then
    raise exception 'only the actual Meeting creator may send initial mobile notifications' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id and deleted_at is null and status='scheduled';
  if not found or not meeting.mobile_notifications_enabled then return 0; end if;
  template := case when target_initial then 'meeting_created' else 'meeting_updated' end;
  version_key := case when target_initial then 'initial' else meeting.notification_requested_at::text end;
  if version_key is null then return 0; end if;

  with candidate_recipients as (
    select meeting.owner_user_id as user_id,null::uuid as occurrence_id
    union
    select guest.user_id,null::uuid from public.meeting_mobile_guest_users(meeting.id, null::uuid) guest
    union
    select matched.user_id,appointment.id
    from public.event_guests subscription
    join public.profiles subscriber on lower(btrim(subscriber.email))=lower(btrim(subscription.email)) and subscriber.status='active'
    join lateral (
      select occurrence.id from public.event_occurrences occurrence
      where occurrence.event_id=meeting.id and occurrence.start_datetime>=subscription.self_join_from
        and occurrence.start_datetime>now() and occurrence.status='scheduled'
        and exists(select 1 from public.occurrence_guest_emails(meeting.id,occurrence.id) current_guest
          where current_guest.email=lower(btrim(subscription.email)))
      order by occurrence.start_datetime limit 1
    ) appointment on true
    join lateral public.meeting_mobile_guest_users(meeting.id,appointment.id) matched on matched.user_id=subscriber.id
    where subscription.event_id=meeting.id and subscription.occurrence_id is null
      and subscription.revoked_at is null and subscription.self_join_from is not null
  ), recipients as (
    select distinct on(user_id) user_id,occurrence_id from candidate_recipients order by user_id,occurrence_id nulls first
  )
  insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload)
  select meeting.id,case when recipient.user_id=meeting.owner_user_id then 'owner' else 'registered_user' end,
    device.id::text,'push',
    concat('meeting-mobile:',meeting.id,':',template,':',version_key,':',device.id),now(),template,
    jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
      'description',meeting.description,'start_datetime',coalesce(appointment.start_datetime,meeting.start_datetime),
      'end_datetime',coalesce(appointment.end_datetime,meeting.end_datetime),'location',meeting.location,'push_user_id',recipient.user_id)
      ||case when recipient.occurrence_id is not null then jsonb_build_object('occurrence_id',recipient.occurrence_id) else '{}'::jsonb end
  from recipients recipient
  left join public.event_occurrences appointment on appointment.id=recipient.occurrence_id
  join public.profiles profile on profile.id=recipient.user_id and profile.status='active'
  join public.mobile_push_subscriptions device on device.user_id=recipient.user_id and device.endpoint like 'https://%'
  on conflict(idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;


notify pgrst, 'reload schema';
commit;
