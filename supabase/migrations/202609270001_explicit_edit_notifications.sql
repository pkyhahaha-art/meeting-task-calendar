-- Editing forms finish their documents and recipient lists before requesting one update email.
alter table public.events
  add column if not exists notification_requested_at timestamptz,
  add column if not exists suppress_guest_notifications boolean not null default false;
alter table public.tasks
  add column if not exists notification_requested_at timestamptz;

create or replace function public.queue_notification(
  target_event_id uuid, target_task_id uuid, target_recipient_type text,
  target_recipient text, target_template text, target_payload jsonb,
  target_scheduled_at timestamptz default now()
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_recipient is null or btrim(target_recipient) = '' then return; end if;
  insert into public.notification_deliveries (
    event_id, task_id, recipient_type, recipient_reference, channel,
    idempotency_key, scheduled_at, template_key, payload
  ) values (
    target_event_id, target_task_id, target_recipient_type, lower(btrim(target_recipient)), 'email',
    concat_ws(':', coalesce(target_event_id::text, target_task_id::text), target_template,
      lower(btrim(target_recipient)), to_char(target_scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS')),
    target_scheduled_at, target_template, coalesce(target_payload, '{}'::jsonb)
  ) on conflict (idempotency_key) do nothing;
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
  if tg_op = 'UPDATE' and new.notification_requested_at is not distinct from old.notification_requested_at
    and new.status is not distinct from old.status then return new; end if;
  template := case when tg_op = 'INSERT' then 'meeting_created'
    when new.status = 'cancelled' then 'meeting_cancelled' else 'meeting_updated' end;
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
  if event_row.id is not null and not event_row.suppress_guest_notifications then
    perform public.queue_notification(event_row.id, null, 'guest', new.email, 'meeting_guest_added',
      jsonb_build_object('entity', 'meeting', 'id', event_row.id, 'title', event_row.title,
        'start_datetime', event_row.start_datetime, 'end_datetime', event_row.end_datetime,
        'location', event_row.location, 'status', event_row.status));
  end if;
  return new;
end;
$$;

create or replace function public.queue_task_email_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  recipient text;
  template text;
  payload jsonb;
begin
  if current_setting('app.materializing_task_series', true) = 'true' then return new; end if;
  if tg_op = 'UPDATE' and new.notification_requested_at is not distinct from old.notification_requested_at
    and new.status is not distinct from old.status then return new; end if;
  template := case when tg_op = 'INSERT' then 'task_assigned'
    when new.status = 'completed' and old.status <> 'completed' then 'task_completed'
    when new.status = 'cancelled' then 'task_cancelled' else 'task_updated' end;
  payload := jsonb_build_object('entity', 'task', 'id', new.id, 'title', new.title,
    'description', new.description, 'due_date', new.due_date, 'due_time', new.due_time, 'status', new.status);
  if template = 'task_completed' then
    select p.email into recipient from public.profiles p where p.id = new.creator_user_id;
    perform public.queue_notification(null, new.id, 'task_creator', recipient, template, payload);
    return new;
  end if;
  if new.assignee_type = 'external' and template in ('task_assigned', 'task_updated') then return new; end if;
  if new.assignee_type = 'internal' then
    select p.email into recipient from public.profiles p where p.id = new.assignee_user_id;
    perform public.queue_notification(null, new.id, 'task_assignee', recipient, template, payload);
  else
    perform public.queue_notification(null, new.id, 'external_assignee', new.external_assignee_email, template, payload);
  end if;
  return new;
end;
$$;

drop trigger if exists queue_event_email_on_change on public.events;
create trigger queue_event_email_on_change
  after insert or update of title, description, start_datetime, end_datetime, location, status, notification_requested_at on public.events
  for each row execute function public.queue_event_email_notifications();
drop trigger if exists queue_task_email_on_change on public.tasks;
create trigger queue_task_email_on_change
  after insert or update of title, description, due_date, due_time, status, assignee_user_id, external_assignee_email, notification_requested_at on public.tasks
  for each row execute function public.queue_task_email_notifications();
