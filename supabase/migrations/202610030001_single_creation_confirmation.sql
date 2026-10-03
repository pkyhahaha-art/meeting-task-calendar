-- One creator confirmation per entity, even when the creator is also a recipient.
create or replace function public.queue_notification(
  target_event_id uuid, target_task_id uuid, target_recipient_type text,
  target_recipient text, target_template text, target_payload jsonb,
  target_scheduled_at timestamptz default now()
)
returns void language plpgsql security definer set search_path = '' as $$
declare recipient_email text := lower(btrim(target_recipient)); creator_email text;
  delivery_template text := target_template; delivery_role text := target_recipient_type;
  delivery_key text;
begin
  if recipient_email is null or recipient_email = '' then return; end if;
  if target_template = 'meeting_guest_added' then
    select lower(btrim(p.email)) into creator_email from public.events e
      join public.profiles p on p.id = e.owner_user_id where e.id = target_event_id;
    if recipient_email = creator_email then return; end if;
  elsif target_template = 'task_assigned' then
    select lower(btrim(p.email)) into creator_email from public.tasks t
      join public.profiles p on p.id = t.creator_user_id where t.id = target_task_id;
    if recipient_email = creator_email then
      delivery_template := 'task_created'; delivery_role := 'task_creator';
    end if;
  end if;
  delivery_key := concat_ws(':', coalesce(target_event_id::text, target_task_id::text),
    delivery_template, recipient_email,
    case when delivery_template in ('meeting_created', 'task_created', 'task_assigned') then 'initial'
      else to_char(target_scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') end);
  insert into public.notification_deliveries(event_id, task_id, recipient_type, recipient_reference,
    channel, idempotency_key, scheduled_at, template_key, payload)
  values (target_event_id, target_task_id, delivery_role, recipient_email, 'email',
    delivery_key, target_scheduled_at, delivery_template, coalesce(target_payload, '{}'::jsonb))
  on conflict (idempotency_key) do nothing;
end;
$$;

-- Called only after the form has saved recipients, reminders and documents.
create or replace function public.queue_creation_confirmation(
  target_event_id uuid default null, target_task_id uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare creator_id uuid; creator_email text; payload jsonb;
begin
  if (target_event_id is not null)::integer + (target_task_id is not null)::integer <> 1 then
    raise exception 'exactly one Meeting or Task is required' using errcode = '22023';
  end if;
  if target_event_id is not null then
    select e.owner_user_id, jsonb_build_object('entity', 'meeting', 'id', e.id,
      'title', e.title, 'description', e.description, 'start_datetime', e.start_datetime,
      'end_datetime', e.end_datetime, 'location', e.location, 'status', e.status)
      into creator_id, payload from public.events e
      where e.id = target_event_id and e.deleted_at is null and e.status = 'scheduled';
  else
    select t.creator_user_id, jsonb_build_object('entity', 'task', 'id', t.id,
      'title', t.title, 'description', t.description, 'due_date', t.due_date,
      'due_time', t.due_time, 'status', t.status)
      into creator_id, payload from public.tasks t
      where t.id = target_task_id and t.deleted_at is null and t.status = 'pending';
  end if;
  if creator_id is null or creator_id is distinct from auth.uid() or not public.is_active_user() then
    raise exception 'only the active creator may confirm creation' using errcode = '42501';
  end if;
  select email into creator_email from public.profiles where id = creator_id;
  perform public.queue_notification(target_event_id, target_task_id,
    case when target_event_id is not null then 'owner' else 'task_creator' end,
    creator_email, case when target_event_id is not null then 'meeting_created' else 'task_created' end, payload);
end;
$$;
revoke all on function public.queue_creation_confirmation(uuid, uuid) from public, anon;
grant execute on function public.queue_creation_confirmation(uuid, uuid) to authenticated;

-- A reminder offset that predates its creation must not be sent as an immediate
-- second email. This also covers old clients and continuous reminder schedules.
create or replace function public.skip_past_task_reminder()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'scheduled' and new.scheduled_at < now() then new.status := 'cancelled'; end if;
  return new;
end;
$$;
drop trigger if exists skip_past_task_reminder on public.task_reminders;
create trigger skip_past_task_reminder before insert or update of scheduled_at on public.task_reminders
  for each row execute function public.skip_past_task_reminder();
