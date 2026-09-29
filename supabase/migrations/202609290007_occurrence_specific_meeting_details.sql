-- Let a recurring Meeting keep details, guests, and documents for one occurrence
-- without changing the base Meeting or creating another reminder schedule.

alter table public.event_guests
  add column if not exists occurrence_id uuid references public.event_occurrences(id) on delete cascade;

alter table public.event_guests
  drop constraint if exists event_guests_event_id_email_key;

create unique index if not exists event_guests_series_email_unique
  on public.event_guests(event_id, email)
  where occurrence_id is null;

create unique index if not exists event_guests_occurrence_email_unique
  on public.event_guests(event_id, occurrence_id, email)
  where occurrence_id is not null;

create table if not exists public.event_occurrence_guest_exclusions (
  occurrence_id uuid not null references public.event_occurrences(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (occurrence_id, email)
);

alter table public.event_occurrence_guest_exclusions enable row level security;
revoke all on table public.event_occurrence_guest_exclusions from anon, authenticated;
grant select on table public.event_occurrence_guest_exclusions to authenticated;
create policy occurrence_guest_exclusions_read on public.event_occurrence_guest_exclusions for select to authenticated
  using (exists (
    select 1 from public.event_occurrences occurrence
    where occurrence.id = occurrence_id and public.can_read_event(occurrence.event_id)
  ));

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

create or replace function public.update_meeting_occurrence_details(
  target_event_id uuid,
  target_occurrence_start timestamptz,
  target_description text,
  target_location text,
  target_guest_emails text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events%rowtype;
  occurrence_row public.event_occurrences%rowtype;
  override_data jsonb;
  desired_emails text[];
  normalized_description text := btrim(coalesce(target_description, ''));
  normalized_location text := btrim(coalesce(target_location, ''));
begin
  if auth.uid() is null or not public.is_active_user() or not public.can_manage_event(target_event_id) then
    raise exception 'only the Meeting owner or an Admin can update this occurrence' using errcode = '42501';
  end if;

  select * into event_row from public.events where id = target_event_id for update;
  if not found or event_row.recurrence_rule is null or event_row.status <> 'scheduled' or event_row.deleted_at is not null then
    raise exception 'a scheduled recurring Meeting is required';
  end if;

  select * into occurrence_row from public.event_occurrences
    where event_id = target_event_id and start_datetime = target_occurrence_start
    for update;
  if not found then
    raise exception 'the selected Meeting occurrence is not available';
  end if;
  if occurrence_row.start_datetime <= now() or occurrence_row.status <> 'scheduled' then
    raise exception 'only a future scheduled occurrence can be updated';
  end if;

  select coalesce(array_agg(email order by email), '{}'::text[]) into desired_emails
  from (
    select distinct lower(btrim(value)) as email
    from unnest(coalesce(target_guest_emails, '{}'::text[])) value
    where btrim(value) <> ''
  ) normalized;
  if exists (select 1 from unnest(desired_emails) email where email !~ '^[^@[:space:]]+@gmail[.]com$') then
    raise exception 'an attendee email must be a Gmail address';
  end if;

  override_data := coalesce(occurrence_row.override_payload, '{}'::jsonb);
  if normalized_description is not distinct from event_row.description then
    override_data := override_data - 'description';
  else
    override_data := jsonb_set(override_data, '{description}', to_jsonb(normalized_description), true);
  end if;
  if normalized_location is not distinct from event_row.location then
    override_data := override_data - 'location';
  else
    override_data := jsonb_set(override_data, '{location}', to_jsonb(normalized_location), true);
  end if;

  update public.event_occurrences
    set override_payload = override_data
    where id = occurrence_row.id;

  delete from public.event_occurrence_guest_exclusions
    where occurrence_id = occurrence_row.id;
  insert into public.event_occurrence_guest_exclusions(occurrence_id, email)
    select occurrence_row.id, lower(guest.email)
    from public.event_guests guest
    where guest.event_id = target_event_id
      and guest.occurrence_id is null
      and guest.revoked_at is null
      and not (lower(guest.email) = any(desired_emails));

  delete from public.event_guests guest
    where guest.event_id = target_event_id
      and guest.occurrence_id = occurrence_row.id
      and not (lower(guest.email) = any(desired_emails));
  update public.event_guests guest
    set revoked_at = null
    where guest.event_id = target_event_id
      and guest.occurrence_id = occurrence_row.id
      and lower(guest.email) = any(desired_emails);
  insert into public.event_guests(event_id, occurrence_id, email)
    select target_event_id, occurrence_row.id, email
    from unnest(desired_emails) email
    where not exists (
      select 1 from public.event_guests guest
      where guest.event_id = target_event_id
        and guest.occurrence_id is null
        and guest.revoked_at is null
        and lower(guest.email) = email
    ) and not exists (
      select 1 from public.event_guests guest
      where guest.event_id = target_event_id
        and guest.occurrence_id = occurrence_row.id
        and lower(guest.email) = email
    );

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'MEETING_OCCURRENCE_UPDATED', 'event_occurrence', occurrence_row.id::text,
    jsonb_build_object('event_id', target_event_id, 'start_datetime', occurrence_row.start_datetime)
  );
  return occurrence_row.id;
end;
$$;

create or replace function public.validate_meeting_attachment_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.occurrence_id is null and new.scope <> 'series' then
    raise exception 'a series attachment must use series scope';
  end if;
  if new.occurrence_id is not null then
    if new.scope <> 'occurrence' then raise exception 'an occurrence attachment must use occurrence scope'; end if;
    if not exists (
      select 1 from public.event_occurrences occurrence
      where occurrence.id = new.occurrence_id and occurrence.event_id = new.event_id
    ) then
      raise exception 'the attachment occurrence must belong to its Meeting';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists attachments_validate_meeting_scope on public.attachments;
create trigger attachments_validate_meeting_scope
  before insert or update of event_id, occurrence_id, scope on public.attachments
  for each row execute function public.validate_meeting_attachment_scope();

create or replace function public.queue_event_email_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_email text; template text; payload jsonb; guest_row record;
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
  for guest_row in select email from public.event_guests
    where event_id = new.id and occurrence_id is null and revoked_at is null loop
    perform public.queue_notification(new.id, null, 'guest', guest_row.email, template, payload);
  end loop;
  return new;
end;
$$;

create or replace function public.queue_event_guest_email_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if new.occurrence_id is not null or new.revoked_at is not null then return new; end if;
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

create or replace function public.queue_meeting_initial_notifications(target_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare event_row public.events; owner_email text; guest_row record; payload jsonb; notification_count integer := 0;
begin
  if not public.can_manage_event(target_event_id) then
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
  for guest_row in select email from public.event_guests
    where event_id = event_row.id and occurrence_id is null and revoked_at is null loop
    perform public.queue_notification(event_row.id, null, 'guest', guest_row.email, 'meeting_guest_added', payload);
    notification_count := notification_count + 1;
  end loop;
  return notification_count;
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
      overdue_day := (now() at time zone 'Asia/Bangkok')::date - (task_reminder.scheduled_at at time zone 'Asia/Bangkok')::date;
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
    for recipient in select email from public.task_external_recipients where task_id = task_reminder.task_id loop
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

revoke all on function public.occurrence_guest_emails(uuid, uuid) from public;
revoke all on function public.update_meeting_occurrence_details(uuid, timestamptz, text, text, text[]) from public, anon;
grant execute on function public.occurrence_guest_emails(uuid, uuid) to service_role;
grant execute on function public.update_meeting_occurrence_details(uuid, timestamptz, text, text, text[]) to authenticated;
