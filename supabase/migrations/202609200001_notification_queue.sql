-- Queue transactional email notifications for Meeting and Task lifecycle changes.

alter table public.notification_deliveries
  add column if not exists template_key text not null default 'entity_updated',
  add column if not exists payload jsonb not null default '{}'::jsonb;

create or replace function public.queue_notification(
  target_event_id uuid,
  target_task_id uuid,
  target_recipient_type text,
  target_recipient text,
  target_template text,
  target_payload jsonb,
  target_scheduled_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_recipient is null or btrim(target_recipient) = '' then
    return;
  end if;

  insert into public.notification_deliveries (
    event_id, task_id, recipient_type, recipient_reference, channel,
    idempotency_key, scheduled_at, template_key, payload
  )
  values (
    target_event_id, target_task_id, target_recipient_type, lower(btrim(target_recipient)), 'email',
    concat_ws(':', coalesce(target_event_id::text, target_task_id::text), target_template,
      lower(btrim(target_recipient)), to_char(target_scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MISS')),
    target_scheduled_at, target_template, coalesce(target_payload, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.queue_event_email_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  owner_email text;
  template text;
  payload jsonb;
  guest_row record;
begin
  event_row := coalesce(new, old);
  template := case
    when tg_op = 'INSERT' then 'meeting_created'
    when event_row.status = 'cancelled' then 'meeting_cancelled'
    else 'meeting_updated'
  end;
  payload := jsonb_build_object(
    'entity', 'meeting', 'id', event_row.id, 'title', event_row.title,
    'start_datetime', event_row.start_datetime, 'end_datetime', event_row.end_datetime,
    'location', event_row.location, 'status', event_row.status
  );

  select p.email into owner_email from public.profiles p where p.id = event_row.owner_user_id;
  perform public.queue_notification(event_row.id, null, 'owner', owner_email, template, payload);

  for guest_row in select email from public.event_guests where event_id = event_row.id and revoked_at is null loop
    perform public.queue_notification(event_row.id, null, 'guest', guest_row.email, template, payload);
  end loop;
  return event_row;
end;
$$;

create or replace function public.queue_event_guest_email_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
begin
  if new.revoked_at is not null then return new; end if;
  select * into event_row from public.events where id = new.event_id;
  if event_row.id is not null then
    perform public.queue_notification(
      event_row.id, null, 'guest', new.email, 'meeting_guest_added',
      jsonb_build_object('entity', 'meeting', 'id', event_row.id, 'title', event_row.title,
        'start_datetime', event_row.start_datetime, 'end_datetime', event_row.end_datetime,
        'location', event_row.location, 'status', event_row.status)
    );
  end if;
  return new;
end;
$$;

create or replace function public.queue_task_email_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.tasks;
  recipient text;
  recipient_kind text;
  template text;
  payload jsonb;
begin
  task_row := new;
  template := case
    when tg_op = 'INSERT' then 'task_assigned'
    when new.status = 'completed' and old.status <> 'completed' then 'task_completed'
    when new.status = 'cancelled' then 'task_cancelled'
    else 'task_updated'
  end;
  payload := jsonb_build_object(
    'entity', 'task', 'id', task_row.id, 'title', task_row.title,
    'description', task_row.description, 'due_date', task_row.due_date,
    'due_time', task_row.due_time, 'status', task_row.status
  );

  if template = 'task_completed' then
    select p.email into recipient from public.profiles p where p.id = task_row.creator_user_id;
    perform public.queue_notification(null, task_row.id, 'task_creator', recipient, template, payload);
    return new;
  end if;

  if task_row.assignee_type = 'internal' then
    recipient_kind := 'task_assignee';
    select p.email into recipient from public.profiles p where p.id = task_row.assignee_user_id;
  else
    recipient_kind := 'external_assignee';
    recipient := task_row.external_assignee_email;
  end if;
  perform public.queue_notification(null, task_row.id, recipient_kind, recipient, template, payload);
  return new;
end;
$$;

drop trigger if exists queue_event_email_on_change on public.events;
create trigger queue_event_email_on_change
  after insert or update of title, description, start_datetime, end_datetime, location, status on public.events
  for each row execute function public.queue_event_email_notifications();

drop trigger if exists queue_event_guest_email_on_add on public.event_guests;
create trigger queue_event_guest_email_on_add
  after insert on public.event_guests
  for each row execute function public.queue_event_guest_email_notification();

drop trigger if exists queue_task_email_on_change on public.tasks;
create trigger queue_task_email_on_change
  after insert or update of title, description, due_date, due_time, status, assignee_user_id, external_assignee_email on public.tasks
  for each row execute function public.queue_task_email_notifications();

grant execute on function public.queue_notification(uuid, uuid, text, text, text, jsonb, timestamptz) to service_role;
