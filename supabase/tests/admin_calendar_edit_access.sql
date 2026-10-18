-- Random synthetic fixtures; no real sender is invoked and nothing persists.
begin;
do $$
#variable_conflict use_column
<<fixture>>
declare admin_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid();
  disabled_id uuid:=gen_random_uuid(); task_id uuid; completed_id uuid; event_id uuid; occurrence_id uuid; own_event_id uuid; own_task_id uuid;
  admin_device uuid; creator_device uuid; count_value integer; expected integer; file_id uuid:=gen_random_uuid();
  event_file_id uuid:=gen_random_uuid(); original_task jsonb; original_event jsonb; requested timestamptz;
  task_reminder_id uuid; guest_id uuid; link_id uuid; legacy_id uuid; future_child_id uuid; past_child_id uuid; completed_child_id uuid;
  legacy_children_before jsonb;
  start_at timestamptz:=date_trunc('second',now()+interval '14 days'); payload jsonb; templates jsonb;
  admin_path text; owner_path text; event_path text; changed text; actor uuid; saved_id uuid;
begin
  if has_table_privilege('authenticated','public.tasks','delete')
    or has_table_privilege('authenticated','public.events','delete') then raise exception 'Parent hard-delete permission expanded'; end if;
  if has_function_privilege('anon','public.task_creator_mobile_available(uuid)','execute')
    or has_function_privilege('anon','public.can_manage_task(uuid)','execute') then raise exception 'Anonymous helper access expanded'; end if;
  if has_function_privilege('anon','public.queue_meeting_initial_notifications(uuid)','execute')
    or has_function_privilege('anon','public.queue_meeting_mobile_notification(uuid,boolean)','execute') then
    raise exception 'Anonymous initial-notification access expanded'; end if;
  insert into auth.users(id,email,raw_user_meta_data) values
    (admin_id,'admin-edit-'||admin_id||'@gmail.com','{"full_name":"Edit Admin"}'),
    (owner_id,'admin-edit-'||owner_id||'@gmail.com','{"full_name":"Original Creator"}'),
    (member_id,'admin-edit-'||member_id||'@gmail.com','{"full_name":"Other Employee"}'),
    (disabled_id,'admin-edit-'||disabled_id||'@gmail.com','{"full_name":"Disabled Admin"}');
  update public.profiles set status='active' where id in(admin_id,owner_id,member_id);
  update public.profiles set role='admin' where id in(admin_id,disabled_id);
  update public.profiles set status='disabled' where id=disabled_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,due_time)
    values(owner_id,'Admin Task fixture','internal',member_id,(start_at at time zone 'Asia/Bangkok')::date,'09:00') returning id into task_id;
  insert into public.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,status,completed_at)
    values(owner_id,'Completed fixture','internal',member_id,(start_at at time zone 'Asia/Bangkok')::date,'completed',now()) returning id into completed_id;
  -- Match the real post-202610020002 cleanup: no Task recurrence rule remains,
  -- while generated children retain their parent id but are cancelled/in Trash.
  insert into public.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,recurrence_rule,recurrence_series_id)
    values(owner_id,'Cleaned legacy Task root','internal',member_id,(start_at at time zone 'Asia/Bangkok')::date,null,null) returning id into legacy_id;
  insert into public.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,recurrence_series_id,status,deleted_at)
    values(owner_id,'Cleaned future child','internal',member_id,current_date+3,legacy_id,'cancelled',now()) returning id into future_child_id;
  insert into public.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,recurrence_series_id,status,deleted_at)
    values(owner_id,'Cleaned past child','internal',member_id,current_date+2,legacy_id,'cancelled',now()) returning id into past_child_id;
  update public.tasks set due_date=current_date-1 where id=past_child_id;
  insert into public.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,recurrence_series_id,status,deleted_at)
    values(owner_id,'Cleaned former completed child','internal',member_id,current_date+4,legacy_id,'cancelled',now()) returning id into completed_child_id;
  select jsonb_agg(to_jsonb(t) order by t.id) into legacy_children_before from public.tasks t
    where t.id=any(array[future_child_id,past_child_id,completed_child_id]);
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,
    email_notifications_enabled,mobile_notifications_enabled,suppress_guest_notifications)
    values(owner_id,'Admin Meeting fixture',start_at,start_at+interval '1 hour','FREQ=DAILY',3,true,true,true) returning id into event_id;
  insert into public.event_guests(event_id,email) values(event_id,'admin-edit-'||member_id||'@gmail.com');
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(event_id,0,'minute',start_at,true,true);
  perform public.refresh_meeting_occurrences(event_id);
  select id into occurrence_id from public.event_occurrences where event_id=fixture.event_id and occurrence_key=start_at+interval '1 day';
  select to_jsonb(t) into original_task from public.tasks t where t.id=task_id;
  select to_jsonb(e) into original_event from public.events e where e.id=event_id;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    values(admin_id,'https://fcm.googleapis.com/admin-edit-'||admin_id,'fixture','fixture') returning id into admin_device;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  insert into public.events(owner_user_id,title,start_datetime,suppress_guest_notifications)
    values(admin_id,'Admin own Meeting',start_at,true) returning id into own_event_id;
  insert into public.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date)
    values(admin_id,'Admin own Task','internal',admin_id,(start_at at time zone 'Asia/Bangkok')::date) returning id into own_task_id;
  begin update public.events set owner_user_id=owner_id where id=own_event_id; raise exception 'Admin transferred own Meeting creator'; exception when others then
    if sqlerrm='Admin transferred own Meeting creator' then raise; end if; end;
  if public.task_creator_mobile_available(task_id) then raise exception 'Editor device counted as creator device'; end if;
  execute 'reset role';
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    values(owner_id,'https://fcm.googleapis.com/admin-edit-'||owner_id,'fixture','fixture') returning id into creator_device;
  execute 'set local role authenticated';
  if not public.task_creator_mobile_available(task_id)
    or not public.meeting_mobile_recipients_available('{}',event_id) then raise exception 'Original creator pairing not found'; end if;
  -- Admin editing does not turn the editor into the creator or grant first-time
  -- invitations/confirmations; test both the mobile default and explicit flag.
  begin perform public.queue_meeting_initial_notifications(event_id); raise exception 'Admin sent initial email invitations'; exception when insufficient_privilege then null; end;
  begin perform public.queue_meeting_mobile_notification(event_id); raise exception 'Admin sent default initial mobile Push'; exception when insufficient_privilege then null; end;
  begin perform public.queue_meeting_mobile_notification(event_id,true); raise exception 'Admin sent explicit initial mobile Push'; exception when insufficient_privilege then null; end;
  begin perform public.queue_creation_confirmation(event_id,null); raise exception 'Admin sent creator confirmation'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.events where id=event_id and initial_notification_requested_at is not null)
    or exists(select 1 from public.notification_deliveries where event_id=fixture.event_id and template_key in('meeting_created','meeting_guest_added')) then
    raise exception 'Denied Admin initial notification left state or queue rows'; end if;
  update public.tasks set title='Admin edited Task',description='Updated details',due_time='10:00' where id=task_id;
  get diagnostics count_value=row_count;
  if count_value<>1 then raise exception 'Active Admin cannot edit Task'; end if;
  update public.tasks set description='Completed Task metadata' where id=completed_id;
  get diagnostics count_value=row_count;
  if count_value<>1 then raise exception 'Admin cannot edit completed Task metadata'; end if;
  update public.tasks set title='Admin edited legacy details',recurrence_rule=null where id=legacy_id;
  get diagnostics count_value=row_count;
  if count_value<>1 then raise exception 'Admin cannot edit cleaned legacy metadata with a null recurrence rule'; end if;
  begin update public.tasks set recurrence_rule='FREQ=WEEKLY' where id=legacy_id; raise exception 'Admin changed legacy Task recurrence'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  if not exists(select 1 from public.tasks where id=legacy_id and recurrence_rule is null and recurrence_series_id is null)
    or legacy_children_before is distinct from (select jsonb_agg(to_jsonb(t) order by t.id) from public.tasks t
      where t.id=any(array[future_child_id,past_child_id,completed_child_id])) then
    raise exception 'Admin metadata edit changed cleaned legacy root or cancelled/deleted child history'; end if;
  execute 'set local role authenticated';
  perform public.replace_task_internal_recipients(task_id,array[member_id]);
  perform public.replace_task_external_recipients(task_id,array['external-fixture@gmail.com']);
  insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,channel_line)
    values(task_id,'due',start_at,true,true) returning id into task_reminder_id;
  begin update public.task_reminders set task_id=own_task_id where id=task_reminder_id; raise exception 'Admin reparented Task reminder to own Task'; exception when insufficient_privilege then null; end;
  -- Quiet saves must not create update notices.
  if exists(select 1 from public.notification_deliveries where task_id=fixture.task_id and template_key='task_updated') then
    raise exception 'Quiet Task edit notified recipients'; end if;
  begin update public.tasks set status='completed' where id=task_id; raise exception 'Admin completed another creator Task'; exception when insufficient_privilege then null; end;
  begin update public.tasks set status='pending' where id=completed_id; raise exception 'Admin reopened another creator Task'; exception when insufficient_privilege then null; end;
  begin update public.tasks set completed_at=now() where id=task_id; raise exception 'Admin changed completion timestamp'; exception when insufficient_privilege then null; end;
  begin update public.tasks set deleted_at=now(),status='cancelled' where id=task_id; raise exception 'Admin bypassed reason-protected Task Trash'; exception when insufficient_privilege then null; end;
  begin update public.tasks set created_at=now()-interval '1 year' where id=task_id; raise exception 'Admin changed Task creation time'; exception when insufficient_privilege then null; end;
  begin update public.tasks set creator_user_id=admin_id where id=task_id; raise exception 'Admin changed Task creator'; exception when insufficient_privilege then null; end;
  begin update public.events set owner_user_id=admin_id where id=event_id; raise exception 'Admin changed Meeting owner'; exception when others then
    if sqlerrm='Admin changed Meeting owner' then raise; end if; end;
  begin update public.events set created_at=now()-interval '1 year' where id=event_id; raise exception 'Admin changed Meeting creation time'; exception when insufficient_privilege then null; end;
  begin update public.events set purge_at=now() where id=event_id; raise exception 'Admin changed Meeting retention'; exception when insufficient_privilege then null; end;
  begin update public.events set deleted_at=now() where id=event_id; raise exception 'Admin bypassed reason-protected Meeting Trash'; exception when insufficient_privilege then null; end;
  begin update public.events set status='cancelled' where id=event_id; raise exception 'Admin cancelled Meeting via direct update'; exception when insufficient_privilege then null; end;
  -- A broadened edit helper must not grant direct occurrence mutation or owner
  -- cancellation/move RPCs that bypass the separate Admin reason workflow.
  update public.event_occurrences set status='cancelled' where id=occurrence_id;
  get diagnostics count_value=row_count;
  if count_value<>0 then raise exception 'Admin directly changed occurrence status'; end if;
  begin delete from public.event_occurrences where id=occurrence_id;
    get diagnostics count_value=row_count; if count_value<>0 then raise exception 'Admin directly deleted occurrence'; end if;
  exception when insufficient_privilege then null; end;
  begin perform public.cancel_meeting_occurrence(event_id,start_at+interval '1 day'); raise exception 'Admin bypassed cancellation reason RPC'; exception when insufficient_privilege then null; end;
  begin perform public.detach_meeting_occurrence(event_id,start_at+interval '1 day',start_at+interval '4 days','','','{}'); raise exception 'Admin bypassed owner move RPC'; exception when insufficient_privilege then null; end;
  perform public.update_meeting_occurrence_details(event_id,start_at+interval '1 day','Admin appointment details','Room A',
    array['admin-edit-'||member_id||'@gmail.com']);
  payload:=jsonb_build_object('title','Admin edited Meeting','description','Series details','location','Room',
    'affiliation','Fixture unit','all_day',false,'start_datetime',start_at,'end_datetime',start_at+interval '2 hours',
    'recurrence_rule','FREQ=DAILY','recurrence_until',null,'recurrence_count',4,
    'email_notifications_enabled',true,'mobile_notifications_enabled',true);
  templates:=jsonb_build_array(jsonb_build_object('offset_value',0,'offset_unit','minute','scheduled_at',start_at,
    'channel_email',true,'channel_line',true,'status','scheduled'));
  saved_id:=public.save_meeting_event_v3(event_id,payload,array['admin-edit-'||member_id||'@gmail.com'],templates,false);
  if saved_id<>event_id then raise exception 'Admin save changed Meeting identity'; end if;
  if exists(select 1 from public.notification_deliveries where event_id=fixture.event_id and template_key='meeting_updated') then
    raise exception 'Quiet Meeting edit notified recipients'; end if;
  -- Storage and metadata record the real Admin uploader; no file bytes exist.
  admin_path:=admin_id||'/'||task_id||'/'||file_id||'.pdf';
  owner_path:=owner_id||'/'||task_id||'/owner-fixture.pdf';
  event_path:=admin_id||'/'||event_id||'/occurrences/'||occurrence_id||'/'||event_file_id||'.pdf';
  insert into storage.objects(bucket_id,name,owner_id) values('task-documents',admin_path,admin_id::text),('meeting-documents',event_path,admin_id::text);
  insert into public.task_attachments(id,task_id,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(file_id,task_id,'Admin fixture.pdf','application/pdf',1,admin_path,admin_id);
  insert into public.attachments(id,event_id,occurrence_id,scope,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(event_file_id,event_id,occurrence_id,'occurrence','Admin appointment.pdf','application/pdf',1,event_path,admin_id);
  begin insert into storage.objects(bucket_id,name,owner_id) values('task-documents',owner_path,admin_id::text);
    raise exception 'Admin upload used another actor path'; exception when insufficient_privilege then null; end;
  begin insert into public.task_attachments(task_id,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(task_id,'Bad uploader','application/pdf',1,admin_id||'/'||task_id||'/wrong.pdf',owner_id);
    raise exception 'Admin forged uploader'; exception when insufficient_privilege then null; end;
  begin update public.attachments set occurrence_id=null where id=event_file_id; raise exception 'Admin re-scoped existing attachment'; exception when insufficient_privilege then null; end;
  insert into public.document_links(task_id,display_name,url,added_by)
    values(task_id,'Admin link','https://docs.google.com/document/d/fixture/view',admin_id) returning id into link_id;
  begin update public.document_links set task_id=own_task_id where id=link_id; raise exception 'Admin reparented document link to own Task'; exception when insufficient_privilege then null; end;
  select id into guest_id from public.event_guests where event_id=fixture.event_id and occurrence_id is null limit 1;
  begin update public.event_guests set event_id=own_event_id where id=guest_id; raise exception 'Admin reparented guest to own Meeting'; exception when insufficient_privilege then null; end;
  -- Save and notify still targets the original creator and current recipients.
  requested:=clock_timestamp();
  update public.tasks set notification_requested_at=requested where id=task_id;
  perform public.queue_task_update_mobile_notifications(task_id,requested);
  update public.events set notification_requested_at=requested where id=event_id;
  perform public.queue_meeting_mobile_notification(event_id,false);
  execute 'reset role';
  if exists(select 1 from public.notification_deliveries where (task_id=fixture.task_id or event_id=fixture.event_id)
    and channel='push' and recipient_reference=admin_device::text) then raise exception 'Admin editor became recipient'; end if;
  if not exists(select 1 from public.notification_deliveries where task_id=fixture.task_id and channel='push' and recipient_reference=creator_device::text)
    or not exists(select 1 from public.notification_deliveries where event_id=fixture.event_id and channel='push' and recipient_reference=creator_device::text)
    then raise exception 'Original creator Push missing'; end if;
  if not exists(select 1 from public.audit_logs where actor_user_id=admin_id and action='ADMIN_CALENDAR_EDIT' and entity_id=task_id::text)
    or not exists(select 1 from public.audit_logs where actor_user_id=admin_id and action='ADMIN_CALENDAR_EDIT' and entity_id=event_id::text)
    then raise exception 'Admin edit audit missing'; end if;
  if exists(select 1 from public.audit_logs where actor_user_id=admin_id and action='ADMIN_CALENDAR_EDIT'
    and (metadata::text like '%storage_path%' or metadata::text like '%docs.google.com%')) then raise exception 'Private document path/link copied into audit'; end if;
  if not exists(select 1 from public.tasks t where t.id=task_id and t.creator_user_id=owner_id
    and t.creator_name=original_task->>'creator_name' and t.created_at=(original_task->>'created_at')::timestamptz and t.status='pending')
    or not exists(select 1 from public.events e where e.id=event_id and e.owner_user_id=owner_id
      and e.creator_name=original_event->>'creator_name' and e.created_at=(original_event->>'created_at')::timestamptz) then
    raise exception 'Admin edit changed creator identity'; end if;
  -- Nonowners and disabled Admins retain their original denied capabilities.
  foreach actor in array array[member_id,disabled_id] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    execute 'set local role authenticated';
    update public.tasks set title='Forbidden' where id=task_id;
    get diagnostics count_value=row_count; if count_value<>0 then raise exception 'NonactiveAdmin/nonowner edited Task'; end if;
    update public.events set title='Forbidden' where id=event_id;
    get diagnostics count_value=row_count; if count_value<>0 then raise exception 'NonactiveAdmin/nonowner edited Meeting'; end if;
    begin perform public.task_creator_mobile_available(task_id); raise exception 'Unauthorized creator device lookup'; exception when insufficient_privilege then null; end;
    begin perform public.replace_task_external_recipients(task_id,'{}'); raise exception 'Unauthorized recipient edit'; exception when insufficient_privilege then null; end;
    begin perform public.save_meeting_event_v3(event_id,payload,'{}',templates,false); raise exception 'Unauthorized Meeting save'; exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;
  -- An Admin who is a genuine assignee may still acknowledge their own row.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.replace_task_internal_recipients(task_id,array[member_id,admin_id]);
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  perform public.acknowledge_task(task_id);
  -- Exercise RLS deletion of fixture documents only, matching Storage API's
  -- transaction-local protection setting; no actual stored blob is touched.
  perform set_config('storage.allow_delete_query','true',true);
  delete from storage.objects where bucket_id='task-documents' and name=admin_path;
  get diagnostics count_value=row_count; if count_value<>1 then raise exception 'Admin cannot delete fixture file'; end if;
  delete from public.task_attachments where id=file_id;
  get diagnostics count_value=row_count; if count_value<>1 then raise exception 'Admin cannot delete attachment metadata'; end if;
  execute 'reset role';
  -- Creator completion still works after an Admin has edited the task.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  execute 'set local role authenticated';
  if public.queue_meeting_initial_notifications(event_id)<1 then raise exception 'Creator initial email invitations regressed'; end if;
  if public.queue_meeting_mobile_notification(event_id,true)<1 then raise exception 'Creator initial mobile Push regressed'; end if;
  update public.tasks set status='completed' where id=task_id;
  get diagnostics count_value=row_count; if count_value<>1 then raise exception 'Creator completion regressed'; end if;
  execute 'reset role';
end;
$$;
select 'PASS: active Admin edits, immutable creator/status, scoped documents, audit actor, original mobile recipients and ordinary user boundaries' as result;
rollback;
