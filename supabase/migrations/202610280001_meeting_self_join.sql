-- Let a verified active employee join a future Meeting with their own account.
-- Existing owner-managed guest rows, reminders, and notification rules stay in place.
begin;

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
    if target_occurrence_start <> meeting.start_datetime or meeting.start_datetime <= now() then
      raise exception 'a future scheduled Meeting is required' using errcode = '22023';
    end if;
  else
    select * into appointment from public.event_occurrences
    where event_id = target_event_id and start_datetime = target_occurrence_start
    for update;
    if not found or appointment.status <> 'scheduled' or appointment.start_datetime <= now() then
      raise exception 'a future scheduled appointment is required' using errcode = '22023';
    end if;
  end if;

  -- An explicit removal by the Meeting owner remains authoritative.
  if exists (
    select 1 from public.event_guests guest
    where guest.event_id = target_event_id and lower(btrim(guest.email)) = attendee_email
      and guest.revoked_at is not null
      and (guest.occurrence_id is null or target_scope = 'series' or guest.occurrence_id = appointment.id)
  ) or exists (
    select 1 from public.event_occurrence_guest_exclusions exclusion
    join public.event_occurrences occurrence on occurrence.id = exclusion.occurrence_id
    where occurrence.event_id = target_event_id and lower(btrim(exclusion.email)) = attendee_email
      and (target_scope = 'series' or exclusion.occurrence_id = appointment.id)
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
        and lower(btrim(guest.email)) = attendee_email and guest.revoked_at is null) then return false; end if;
    insert into public.event_guests(event_id, email)
    values (target_event_id, attendee_email)
    on conflict (event_id, email) where occurrence_id is null do nothing;
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'MEETING_SELF_JOINED', 'event', target_event_id::text,
    jsonb_build_object('scope', target_scope, 'occurrence_start', target_occurrence_start));
  return true;
end;
$$;

revoke all on function public.join_meeting_as_attendee(uuid,timestamptz,text) from public, anon;
grant execute on function public.join_meeting_as_attendee(uuid,timestamptz,text) to authenticated;
notify pgrst, 'reload schema';
commit;
