-- Initial invitations are opt-in, one-time notifications. They are separate
-- from reminder templates, which repeat for each Meeting occurrence.
alter table public.events
  add column if not exists initial_notification_requested_at timestamptz;

create or replace function public.create_meeting_event_v2(
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
    start_datetime, end_datetime, recurrence_rule, recurrence_until, recurrence_count,
    suppress_guest_notifications
  ) values (
    auth.uid(), target_title, target_description, target_location,
    coalesce(target_affiliation, ''), target_all_day, target_start_datetime,
    target_end_datetime, target_recurrence_rule, target_recurrence_until, target_recurrence_count,
    true
  ) returning * into created_event;

  return created_event;
end;
$$;

create or replace function public.queue_event_email_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner_email text;
  template text;
  payload jsonb;
  guest_row record;
begin
  -- New Meetings are sent only by queue_meeting_initial_notifications(),
  -- after guests and documents have been saved.
  if tg_op = 'INSERT' then return new; end if;
  if new.notification_requested_at is not distinct from old.notification_requested_at
    and new.status is not distinct from old.status then return new; end if;
  template := case when new.status = 'cancelled' then 'meeting_cancelled' else 'meeting_updated' end;
  payload := jsonb_build_object('entity', 'meeting', 'id', new.id, 'title', new.title,
    'start_datetime', new.start_datetime, 'end_datetime', new.end_datetime,
    'location', new.location, 'status', new.status);
  select p.email into owner_email from public.profiles p where p.id = new.owner_user_id;
  perform public.queue_notification(new.id, null, 'owner', owner_email, template, payload);
  for guest_row in select email from public.event_guests where event_id = new.id and revoked_at is null loop
    perform public.queue_notification(new.id, null, 'guest', guest_row.email, template, payload);
  end loop;
  return new;
end;
$$;

create or replace function public.queue_event_guest_email_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if new.revoked_at is not null then return new; end if;
  select * into event_row from public.events where id = new.event_id;
  if event_row.id is not null and not event_row.suppress_guest_notifications
    and event_row.initial_notification_requested_at is not null then
    perform public.queue_notification(event_row.id, null, 'guest', new.email, 'meeting_guest_added',
      jsonb_build_object('entity', 'meeting', 'id', event_row.id, 'title', event_row.title,
        'start_datetime', event_row.start_datetime, 'end_datetime', event_row.end_datetime,
        'location', event_row.location, 'status', event_row.status));
  end if;
  return new;
end;
$$;

create function public.queue_meeting_initial_notifications(target_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  owner_email text;
  guest_row record;
  payload jsonb;
  notification_count integer := 0;
begin
  if not public.can_manage_event(target_event_id) then
    raise exception 'only the Meeting creator may send an initial invitation' using errcode = '42501';
  end if;

  update public.events
    set initial_notification_requested_at = now()
    where id = target_event_id and initial_notification_requested_at is null
    returning * into event_row;
  if not found then return 0; end if;

  payload := jsonb_build_object('entity', 'meeting', 'id', event_row.id, 'title', event_row.title,
    'description', event_row.description, 'start_datetime', event_row.start_datetime,
    'end_datetime', event_row.end_datetime, 'location', event_row.location, 'status', event_row.status);
  select email into owner_email from public.profiles where id = event_row.owner_user_id;
  perform public.queue_notification(event_row.id, null, 'owner', owner_email, 'meeting_created', payload);
  notification_count := 1;
  for guest_row in select email from public.event_guests where event_id = event_row.id and revoked_at is null loop
    perform public.queue_notification(event_row.id, null, 'guest', guest_row.email, 'meeting_guest_added', payload);
    notification_count := notification_count + 1;
  end loop;
  return notification_count;
end;
$$;

revoke all on function public.create_meeting_event_v2(text, text, text, text, boolean, timestamptz, timestamptz, text, timestamptz, integer) from public, anon;
revoke all on function public.queue_meeting_initial_notifications(uuid) from public, anon;
grant execute on function public.create_meeting_event_v2(text, text, text, text, boolean, timestamptz, timestamptz, text, timestamptz, integer) to authenticated;
grant execute on function public.queue_meeting_initial_notifications(uuid) to authenticated;
