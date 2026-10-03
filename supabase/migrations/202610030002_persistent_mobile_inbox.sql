begin;
-- The sender reads the occurrence behind a reminder before composing its message.
grant select on public.reminders to service_role;
alter table public.events add column if not exists mobile_notifications_enabled boolean not null default false;
update public.events e set mobile_notifications_enabled=true
  where not e.mobile_notifications_enabled and exists(select 1 from public.reminders r where r.event_id=e.id and r.channel_line);

create or replace function public.skip_past_meeting_reminder()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status='scheduled' and new.scheduled_at < now() then new.status:='cancelled'; end if;
  return new;
end;
$$;
drop trigger if exists skip_past_meeting_reminder on public.reminders;
create trigger skip_past_meeting_reminder before insert or update of scheduled_at on public.reminders
  for each row execute function public.skip_past_meeting_reminder();

-- Prove possession of this device's existing Push secret. This returns connection
-- status only; it does not create a login or expose calendar data to anonymous clients.
create or replace function public.get_mobile_device_status(target_endpoint text, target_auth text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare device record;
begin
  if target_auth is null or length(target_auth) < 20 then return jsonb_build_object('paired',false); end if;
  select s.id, s.user_id, p.full_name into device from public.mobile_push_subscriptions s
    join public.profiles p on p.id=s.user_id and p.status='active'
    where s.endpoint=target_endpoint and s.auth=target_auth;
  if not found then return jsonb_build_object('paired',false); end if;
  return jsonb_build_object('paired',true,'subscription_id',device.id,'user_name',device.full_name,'user_id',device.user_id);
end;
$$;
revoke all on function public.get_mobile_device_status(text,text) from public;
grant execute on function public.get_mobile_device_status(text,text) to anon,authenticated;

-- A mobile confirmation is opt-in and goes only to the Meeting creator's devices.
create or replace function public.queue_meeting_mobile_notification(target_event_id uuid, target_initial boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare meeting public.events; queued integer; template text; version_key text;
begin
  if not public.can_manage_event(target_event_id) then
    raise exception 'only the active Meeting creator may notify their devices' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id and deleted_at is null and status='scheduled';
  if not found then return 0; end if;
  template := case when target_initial then 'meeting_created' else 'meeting_updated' end;
  version_key := case when target_initial then 'initial' else meeting.notification_requested_at::text end;
  if version_key is null then return 0; end if;
  insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload)
  select meeting.id,'owner',device.id::text,'push',
    concat('meeting-mobile:',meeting.id,':',template,':',version_key,':',device.id),now(),template,
    jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
      'description',meeting.description,'start_datetime',meeting.start_datetime,
      'end_datetime',meeting.end_datetime,'location',meeting.location,'push_user_id',meeting.owner_user_id)
  from public.mobile_push_subscriptions device where device.user_id=meeting.owner_user_id and device.endpoint like 'https://%'
  on conflict(idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke all on function public.queue_meeting_mobile_notification(uuid,boolean) from public,anon;
grant execute on function public.queue_meeting_mobile_notification(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
