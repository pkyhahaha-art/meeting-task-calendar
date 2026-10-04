-- All fixtures and queues roll back. No messages or files are sent.
begin;
do $$
declare creator_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); creator_device uuid;
  second_device uuid; member_device uuid; v_task_id uuid; v_event_id uuid; delivery_id uuid;
  member_delivery uuid; appointment_id uuid; other_appointment uuid; root_reminder uuid; result jsonb; first_at timestamptz;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (creator_id,'rollback-'||creator_id||'@gmail.com','{"full_name":"Inbox Creator"}'),
    (member_id,'rollback-'||member_id||'@gmail.com','{"full_name":"Inbox Member"}');
  update public.profiles set status='active' where id in(creator_id,member_id);
  perform set_config('request.jwt.claim.sub',creator_id::text,true);
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    values(creator_id,'https://web.push.apple.com/rollback-'||creator_id,'fixture','fixture') returning id into creator_device;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    values(creator_id,'https://fcm.googleapis.com/rollback-'||creator_id,'fixture','fixture') returning id into second_device;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    values(member_id,'https://fcm.googleapis.com/rollback-'||member_id,'fixture','fixture') returning id into member_device;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,affiliation,description,due_date,due_time)
    values(creator_id,'internal',member_id,'Inbox Task','Task Department','Full task instructions',current_date+3,'09:00') returning id into v_task_id;
  insert into public.task_internal_recipients(task_id,user_id) values(v_task_id,member_id) on conflict do nothing;
  insert into public.task_attachments(task_id,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(v_task_id,'Task.pdf','application/pdf',1024,creator_id||'/'||v_task_id||'/task.pdf',creator_id);
  insert into public.document_links(task_id,display_name,url,added_by)
    values(v_task_id,'Drive notes','https://docs.google.com/document/d/rollback',creator_id);
  perform public.queue_task_creation_mobile_confirmation(v_task_id);
  select d.id into delivery_id from public.notification_deliveries d where d.task_id=v_task_id and d.channel='push' and d.recipient_reference=creator_device::text;
  result:=public.mobile_notification_details(creator_device,delivery_id);
  if result->'details'->>'affiliation'<>'Task Department' or result->'details'->>'due_time'<>'09:00:00'
    or jsonb_array_length(result->'documents')<>2 then raise exception 'Task details or documents missing'; end if;
  if public.mobile_notification_details(second_device,delivery_id) is not null
    or public.mobile_notification_details(member_device,delivery_id) is not null then raise exception 'Another device read this delivery'; end if;
  insert into public.notification_deliveries(task_id,recipient_type,recipient_reference,channel,idempotency_key,scheduled_at,template_key,payload)
    values(v_task_id,'task_assignee',member_device::text,'push','rollback-task-'||v_task_id,now(),'task_reminder',
      jsonb_build_object('entity','task','id',v_task_id,'push_user_id',member_id)) returning id into member_delivery;
  if public.mobile_notification_details(member_device,member_delivery) is null then raise exception 'Current assignee cannot read their delivery'; end if;
  delete from public.task_internal_recipients r where r.task_id=v_task_id;
  update public.tasks set assignee_type='external',assignee_user_id=null,external_assignee_email='rollback@gmail.com' where id=v_task_id;
  if public.mobile_notification_details(member_device,member_delivery) is not null then raise exception 'Removed assignee can still fetch documents'; end if;

  first_at:=now()+interval '3 days';
  insert into public.events(owner_user_id,title,affiliation,description,start_datetime,end_datetime,recurrence_rule,recurrence_count,
    suppress_guest_notifications,mobile_notifications_enabled)
    values(creator_id,'Inbox Meeting','Meeting Department','Series notes',first_at,first_at+interval '1 hour','FREQ=DAILY',2,true,true) returning id into v_event_id;
  insert into public.event_guests(event_id,email) values(v_event_id,'rollback-'||member_id||'@gmail.com');
  perform public.refresh_meeting_occurrences(v_event_id);
  select o.id into appointment_id from public.event_occurrences o where o.event_id=v_event_id order by o.start_datetime limit 1;
  select o.id into other_appointment from public.event_occurrences o where o.event_id=v_event_id order by o.start_datetime desc limit 1;
  update public.event_occurrences set override_payload='{"description":"Only this appointment","location":"Room 7"}' where id=appointment_id;
  insert into public.attachments(event_id,occurrence_id,scope,file_name,mime_type,file_size,storage_path,uploaded_by) values
    (v_event_id,null,'series','Series.pdf','application/pdf',1024,creator_id||'/'||v_event_id||'/series.pdf',creator_id),
    (v_event_id,appointment_id,'occurrence','This appointment.pdf','application/pdf',1024,creator_id||'/'||v_event_id||'/this.pdf',creator_id),
    (v_event_id,other_appointment,'occurrence','Other appointment.pdf','application/pdf',1024,creator_id||'/'||v_event_id||'/other.pdf',creator_id);
  insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,idempotency_key,scheduled_at,template_key,payload)
    values(v_event_id,'registered_user',member_device::text,'push','rollback-meeting-'||v_event_id,now(),'meeting_reminder',
      jsonb_build_object('entity','meeting','id',v_event_id,'occurrence_id',appointment_id,'push_user_id',member_id)) returning id into member_delivery;
  result:=public.mobile_notification_details(member_device,member_delivery);
  if result->'details'->>'affiliation'<>'Meeting Department' or result->'details'->>'description'<>'Only this appointment'
    or result->'details'->>'location'<>'Room 7' or jsonb_array_length(result->'documents')<>2
    or result::text like '%Other appointment.pdf%' then raise exception 'Meeting details or appointment document scope incorrect'; end if;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(v_event_id,0,'minute',first_at,false,true) returning id into root_reminder;
  update public.notification_deliveries set reminder_id=root_reminder,payload=payload-'occurrence_id' where id=member_delivery;
  result:=public.mobile_notification_details(member_device,member_delivery);
  if result->'details'->>'description'<>'Only this appointment' or jsonb_array_length(result->'documents')<>2
    then raise exception 'Root reminder did not resolve the first appointment'; end if;

  -- Cancellation keeps the concise action context plus full, currently
  -- authorized details/documents of precisely the cancelled appointment.
  perform public.cancel_meeting_occurrence(v_event_id,first_at);
  select d.id into member_delivery from public.notification_deliveries d where d.event_id=v_event_id
    and d.recipient_reference=member_device::text and d.template_key='meeting_occurrence_cancelled';
  result:=public.mobile_notification_details(member_device,member_delivery);
  if result is null or result->'details'->>'notification_template'<>'meeting_occurrence_cancelled'
    or result->'details'->>'status'<>'cancelled' or result->'details'->>'affiliation'<>'Meeting Department'
    or result->'details'->>'description'<>'Only this appointment' or result->'details'->>'location'<>'Room 7'
    or (result->'details'->>'original_occurrence_start')::timestamptz<>first_at
    or (result->'details'->>'end_datetime')::timestamptz<>first_at+interval '1 hour'
    or jsonb_array_length(result->'documents')<>2 or result::text like '%Other appointment.pdf%' then
    raise exception 'Cancellation lost full details, correct status or private appointment document scope'; end if;
  if not exists(select 1 from public.notification_deliveries d where d.id=member_delivery
    and d.payload->>'description'='Only this appointment' and d.payload->>'location'='Room 7'
    and d.payload->>'affiliation'='Meeting Department'
    and (d.payload->>'end_datetime')::timestamptz=first_at+interval '1 hour') then
    raise exception 'Cancellation queue snapshot lacks selected appointment details'; end if;
  -- Already queued 003 notices lack rich snapshot fields. They must still open
  -- through current entity permissions, and retain the immutable action dates.
  update public.notification_deliveries set payload=payload-'description'-'location'-'affiliation'-'end_datetime'-'occurrence_id'
    where id=member_delivery;
  result:=public.mobile_notification_details(member_device,member_delivery);
  if result->'details'->>'description'<>'Only this appointment' or jsonb_array_length(result->'documents')<>2 then
    raise exception 'Legacy cancellation payload cannot resolve authorized occurrence details'; end if;

  declare
    moved_id uuid; moved_delivery uuid; old_member_delivery uuid:=member_delivery;
  begin
    moved_id:=public.detach_meeting_occurrence(v_event_id,first_at+interval '1 day',first_at+interval '3 days',
      'Moved appointment agenda','Room 8',array['rollback-'||member_id||'@gmail.com']);
    -- Existing frontend copies documents after the atomic move; fixture the
    -- new Meeting's documents to verify that the new delivery resolves them.
    insert into public.attachments(event_id,scope,file_name,mime_type,file_size,storage_path,uploaded_by)
      values(moved_id,'series','Moved.pdf','application/pdf',1024,creator_id||'/'||moved_id||'/moved.pdf',creator_id);
    insert into public.document_links(event_id,display_name,url,added_by)
      values(moved_id,'Moved Drive notes','https://docs.google.com/document/d/rollback-moved',creator_id);
    select d.id into moved_delivery from public.notification_deliveries d where d.event_id=moved_id
      and d.recipient_reference=member_device::text and d.template_key='meeting_occurrence_moved';
    result:=public.mobile_notification_details(member_device,moved_delivery);
    if result is null or result->'details'->>'notification_template'<>'meeting_occurrence_moved'
      or result->'details'->>'description'<>'Moved appointment agenda' or result->'details'->>'location'<>'Room 8'
      or result->'details'->>'affiliation'<>'Meeting Department' or result->'details'->>'status'<>'scheduled'
      or (result->'details'->>'original_occurrence_start')::timestamptz<>first_at+interval '1 day'
      or (result->'details'->>'new_occurrence_start')::timestamptz<>first_at+interval '3 days'
      or jsonb_array_length(result->'documents')<>2 or result::text like '%Series.pdf%' then
      raise exception 'Moved notice did not resolve new Meeting details/documents and original/new dates'; end if;
    update public.event_guests set revoked_at=now() where event_id=moved_id;
    if public.mobile_notification_details(member_device,moved_delivery) is not null then
      raise exception 'Withdrawn moved appointment guest still reads details/documents'; end if;
    insert into public.event_occurrence_guest_exclusions(occurrence_id,email)
      values(appointment_id,'rollback-'||member_id||'@gmail.com');
    if public.mobile_notification_details(member_device,old_member_delivery) is not null then
      raise exception 'Excluded cancelled appointment guest still reads details/documents'; end if;
    delete from public.event_occurrence_guest_exclusions where occurrence_id=appointment_id;
  end;
  update public.event_guests set revoked_at=now() where event_guests.event_id=v_event_id;
  if public.mobile_notification_details(member_device,member_delivery) is not null then raise exception 'Revoked attendee can still fetch documents'; end if;
  update public.mobile_push_subscriptions set user_id=member_id where id=creator_device;
  if public.mobile_notification_details(creator_device,delivery_id) is not null then raise exception 'Re-paired device reads previous account'; end if;
  update public.profiles set status='disabled' where id=creator_id;
  if public.mobile_notification_details(second_device,delivery_id) is not null then raise exception 'Inactive account can read'; end if;
  if has_function_privilege('anon','public.mobile_notification_details(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.mobile_notification_details(uuid,uuid)','execute')
    then raise exception 'Private metadata RPC is publicly accessible'; end if;
end; $$;
select 'PASS: Task/Meeting metadata, private documents, occurrence scope, device isolation, revoked recipients and re-pairing access checks' as result;
rollback;
