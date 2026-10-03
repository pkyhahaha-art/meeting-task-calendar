begin;

-- The Edge Function proves device ownership before calling this private RPC.
-- A delivery id alone never authorizes access to the item or its documents.
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
        or o.id=(select r.occurrence_id from public.reminders r where r.id=delivery.reminder_id)
        or (o.occurrence_key=meeting.start_datetime and exists(
          select 1 from public.reminders r where r.id=delivery.reminder_id and r.event_id=meeting.id and r.occurrence_id is null)))
      limit 1;
    if meeting.owner_user_id<>recipient_id and not exists(
      select 1 from public.meeting_mobile_guest_users(meeting.id,appointment.id) g where g.user_id=recipient_id
    ) then return null; end if;
    details:=jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
      'affiliation',meeting.affiliation,'all_day',meeting.all_day,
      'description',coalesce(appointment.override_payload->>'description',meeting.description),
      'location',coalesce(appointment.override_payload->>'location',meeting.location),
      'start_datetime',coalesce(appointment.start_datetime,meeting.start_datetime),
      'end_datetime',coalesce(appointment.end_datetime,meeting.end_datetime),'status',meeting.status);
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

commit;
