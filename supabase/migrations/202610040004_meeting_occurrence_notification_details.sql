begin;

-- Preserve concise action headlines while restoring authorized Meeting details.
create or replace function public.queue_meeting_occurrence_action(
  target_event_id uuid,target_occurrence_id uuid,target_original_start timestamptz,
  target_new_start timestamptz,target_original_event_id uuid,target_original_occurrence_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences; payload jsonb; template text; action_key text;
begin
  select * into meeting from public.events where id=target_event_id;
  if not found then return; end if;
  select * into appointment from public.event_occurrences
    where event_id=meeting.id and id=target_occurrence_id;
  template:=case when target_new_start is null then 'meeting_occurrence_cancelled' else 'meeting_occurrence_moved' end;
  action_key:=concat('meeting-appointment:',target_original_occurrence_id,':',template);
  payload:=jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
    'occurrence_id',target_occurrence_id,'original_event_id',target_original_event_id,
    'original_occurrence_id',target_original_occurrence_id,'original_occurrence_start',target_original_start,
    'new_occurrence_start',target_new_start,'all_day',meeting.all_day,
    'start_datetime',coalesce(target_new_start,target_original_start),
    'status',case when target_new_start is null then 'cancelled' else 'scheduled' end,
    'affiliation',meeting.affiliation,
    'description',coalesce(appointment.override_payload->>'description',meeting.description),
    'location',coalesce(appointment.override_payload->>'location',meeting.location),
    'end_datetime',case when target_occurrence_id is null then meeting.end_datetime else appointment.end_datetime end);

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

create or replace function public.mobile_notification_details(target_device_id uuid, target_delivery_id uuid)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare recipient_id uuid; delivery public.notification_deliveries; task public.tasks;
  meeting public.events; appointment public.event_occurrences; details jsonb; documents jsonb;
begin
  select s.user_id into recipient_id from public.mobile_push_subscriptions s
    join public.profiles p on p.id=s.user_id and p.status='active' where s.id=target_device_id;
  if recipient_id is null then return null; end if;
  select * into delivery from public.notification_deliveries d where d.id=target_delivery_id
    and d.channel='push' and d.recipient_reference=target_device_id::text
    and d.payload->>'push_user_id'=recipient_id::text;
  if not found then return null; end if;

  if delivery.task_id is not null then
    select * into task from public.tasks t where t.id=delivery.task_id and t.deleted_at is null
      and (t.creator_user_id=recipient_id or t.assignee_user_id=recipient_id
        or exists(select 1 from public.task_internal_recipients r where r.task_id=t.id and r.user_id=recipient_id));
    if not found then return null; end if;
    details:=jsonb_build_object('entity','task','id',task.id,'title',task.title,'affiliation',task.affiliation,
      'description',task.description,'due_date',task.due_date,'due_time',task.due_time,'status',task.status);
    select coalesce(jsonb_agg(file order by file->>'name'),'[]'::jsonb) into documents from (
      select jsonb_build_object('id',a.id,'name',a.file_name,'size',a.file_size,'mime_type',a.mime_type,
        'kind','file','bucket','task-documents','storage_path',a.storage_path) as file
      from public.task_attachments a where a.task_id=task.id
      union all
      select jsonb_build_object('id',l.id,'name',l.display_name,'kind','drive','url',l.url)
      from public.document_links l where l.task_id=task.id
    ) files;
  elsif delivery.event_id is not null then
    select * into meeting from public.events e where e.id=delivery.event_id and e.deleted_at is null;
    if not found then return null; end if;
    select * into appointment from public.event_occurrences o where o.event_id=meeting.id
      and (o.id::text=delivery.payload->>'occurrence_id'
        or (delivery.template_key='meeting_occurrence_cancelled' and o.id::text=delivery.payload->>'original_occurrence_id')
        or o.id=(select r.occurrence_id from public.reminders r where r.id=delivery.reminder_id)
        or (o.occurrence_key=meeting.start_datetime and exists(
          select 1 from public.reminders r where r.id=delivery.reminder_id and r.event_id=meeting.id and r.occurrence_id is null)))
      limit 1;
    -- An action for one cancelled date must never fall back to series documents.
    if delivery.template_key='meeting_occurrence_cancelled' and appointment.id is null then return null; end if;
    if meeting.owner_user_id<>recipient_id and not exists(
      select 1 from public.meeting_mobile_guest_users(meeting.id,appointment.id) g where g.user_id=recipient_id
    ) then return null; end if;
    details:=jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
      'affiliation',meeting.affiliation,'all_day',meeting.all_day,
      'description',coalesce(appointment.override_payload->>'description',meeting.description),
      'location',coalesce(appointment.override_payload->>'location',meeting.location),
      'start_datetime',coalesce(appointment.start_datetime,meeting.start_datetime),
      'end_datetime',coalesce(appointment.end_datetime,meeting.end_datetime),
      'status',case when delivery.template_key='meeting_occurrence_cancelled' then 'cancelled' else meeting.status end);
    if delivery.template_key in('meeting_occurrence_cancelled','meeting_occurrence_moved') then
      details:=details||jsonb_build_object('notification_template',delivery.template_key,'notice_template',delivery.template_key,
        'original_occurrence_start',coalesce(delivery.payload->'original_occurrence_start',to_jsonb(appointment.start_datetime)),
        'new_occurrence_start',delivery.payload->'new_occurrence_start');
    end if;
    select coalesce(jsonb_agg(file order by file->>'name'),'[]'::jsonb) into documents from (
      select jsonb_build_object('id',a.id,'name',a.file_name,'size',a.file_size,'mime_type',a.mime_type,
        'kind','file','bucket','meeting-documents','storage_path',a.storage_path) as file
      from public.attachments a where a.event_id=meeting.id and (a.occurrence_id is null or a.occurrence_id=appointment.id)
      union all
      select jsonb_build_object('id',l.id,'name',l.display_name,'kind','drive','url',l.url)
      from public.document_links l where l.event_id=meeting.id
    ) files;
  else return null;
  end if;
  return jsonb_build_object('details',details,'documents',documents);
end;
$$;
revoke all on function public.mobile_notification_details(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mobile_notification_details(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
