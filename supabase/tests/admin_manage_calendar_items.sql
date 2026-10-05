-- Synthetic fixtures only. No sender is invoked; the transaction rolls back.
begin;
do $$
<<fixture>>
declare admin_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  disabled_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid(); fixture_tag text:=gen_random_uuid()::text;
  task_id uuid; kept_task_id uuid; meeting_id uuid; series_id uuid; kept_meeting_id uuid;
  completed_task_id uuid; legacy_id uuid; future_child_id uuid; past_child_id uuid; completed_child_id uuid;
  occurrence_id uuid; sibling_id uuid; past_occurrence_id uuid; reminder_id uuid; sibling_reminder_id uuid;
  first_at timestamptz:=date_trunc('day',now())+interval '14 days 9 hours';
  created_at timestamptz:=date_trunc('day',now())-interval '1 day';
  response jsonb; selected jsonb; count_value integer; actor uuid; queue_status text;
  delivery_id uuid; nonterminal_ids uuid[]:='{}'; terminal_ids uuid[]:='{}'; occurrence_delivery_ids uuid[]:='{}';
  terminal_before jsonb; returned_id uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (admin_id,'rollback-'||admin_id||'@gmail.com','{"full_name":"Rollback Admin"}'),
    (owner_id,'rollback-'||owner_id||'@gmail.com','{"full_name":"Rollback Owner"}'),
    (other_id,'rollback-'||other_id||'@gmail.com','{"full_name":"Rollback Other"}'),
    (disabled_id,'rollback-'||disabled_id||'@gmail.com','{"full_name":"Rollback Disabled Admin"}'),
    (pending_id,'rollback-'||pending_id||'@gmail.com','{"full_name":"Rollback Pending Admin"}');
  update public.profiles set status='active' where id in(admin_id,owner_id,other_id);
  update public.profiles set role='admin' where id in(admin_id,disabled_id,pending_id);
  update public.profiles set status='disabled' where id=disabled_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,affiliation,due_date,due_time,created_at)
    values(owner_id,'internal',other_id,fixture_tag||' selected task','Fixture Unit',(first_at at time zone 'Asia/Bangkok')::date,'10:00',created_at)
    returning id into task_id;
  insert into public.task_internal_recipients(task_id,user_id) values(task_id,other_id) on conflict do nothing;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,created_at)
    values(owner_id,'internal',owner_id,fixture_tag||' kept task',(first_at at time zone 'Asia/Bangkok')::date,created_at)
    returning id into kept_task_id;
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,created_at)
    values(owner_id,fixture_tag||' selected meeting',first_at,first_at+interval '1 hour',created_at) returning id into meeting_id;
  insert into public.events(owner_user_id,title,start_datetime,recurrence_rule,recurrence_count,
    email_notifications_enabled,mobile_notifications_enabled,created_at)
    values(owner_id,fixture_tag||' selected series',first_at,'FREQ=WEEKLY',3,true,false,created_at) returning id into series_id;
  insert into public.events(owner_user_id,title,start_datetime,created_at)
    values(owner_id,fixture_tag||' kept meeting',first_at,created_at) returning id into kept_meeting_id;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,created_at)
    select owner_id,'internal',owner_id,fixture_tag||' page '||n,(first_at at time zone 'Asia/Bangkok')::date,created_at
    from generate_series(1,26) n;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,created_at)
    values(other_id,'internal',other_id,fixture_tag||' other creator',(first_at at time zone 'Asia/Bangkok')::date,created_at);
  insert into public.task_attachments(task_id,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(task_id,'task.pdf','application/pdf',100,'rollback/'||fixture_tag||'/task.pdf',owner_id);
  insert into public.attachments(event_id,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(meeting_id,'meeting.pdf','application/pdf',100,'rollback/'||fixture_tag||'/meeting.pdf',owner_id);
  insert into public.event_occurrences(event_id,occurrence_key,start_datetime,end_datetime)
    values(series_id,first_at,first_at,first_at+interval '1 hour') returning id into occurrence_id;
  insert into public.event_occurrences(event_id,occurrence_key,start_datetime,end_datetime)
    values(series_id,first_at+interval '7 days',first_at+interval '7 days',first_at+interval '7 days 1 hour') returning id into sibling_id;
  insert into public.reminders(event_id,occurrence_id,offset_value,offset_unit,scheduled_at,channel_email)
    values(series_id,occurrence_id,1,'hour',first_at-interval '1 hour',true) returning id into reminder_id;
  insert into public.reminders(event_id,occurrence_id,offset_value,offset_unit,scheduled_at,channel_email)
    values(series_id,sibling_id,1,'hour',first_at+interval '7 days'-interval '1 hour',true) returning id into sibling_reminder_id;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,status)
    values(meeting_id,1,'hour',first_at-interval '1 hour',true,'processing'),
      (meeting_id,1,'day',first_at-interval '1 day',true,'completed');
  insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,status)
    values(task_id,'due',first_at,true,'scheduled'),(task_id,'overdue',first_at+interval '1 day',true,'deferred_quota'),
      (task_id,'1_hour',first_at-interval '1 hour',true,'processing'),(task_id,'1_day',first_at-interval '1 day',true,'completed');
  for queue_status in select unnest(array['queued','retry','deferred_quota','processing']) loop
    insert into public.notification_deliveries(task_id,recipient_type,recipient_reference,channel,idempotency_key,
      scheduled_at,next_attempt_at,status,template_key,payload)
      values(task_id,'task_assignee','rollback-'||other_id||'@gmail.com','email',fixture_tag||':task:'||queue_status,
        first_at,first_at,queue_status,'task_reminder','{}') returning id into delivery_id;
    nonterminal_ids:=array_append(nonterminal_ids,delivery_id);
    insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,idempotency_key,
      scheduled_at,next_attempt_at,status,template_key,payload)
      values(meeting_id,'owner','rollback-'||owner_id||'@gmail.com','email',fixture_tag||':meeting:'||queue_status,
        first_at,first_at,queue_status,'meeting_reminder','{}') returning id into delivery_id;
    nonterminal_ids:=array_append(nonterminal_ids,delivery_id);
    insert into public.notification_deliveries(event_id,reminder_id,recipient_type,recipient_reference,channel,idempotency_key,
      scheduled_at,status,template_key,payload)
      values(series_id,reminder_id,'owner','rollback-'||owner_id||'@gmail.com','email',fixture_tag||':occurrence:'||queue_status,
        first_at,queue_status,'meeting_reminder',jsonb_build_object('occurrence_id',occurrence_id)) returning id into delivery_id;
    occurrence_delivery_ids:=array_append(occurrence_delivery_ids,delivery_id);
  end loop;
  for queue_status in select unnest(array['sent','failed','skipped']) loop
    insert into public.notification_deliveries(task_id,event_id,recipient_type,recipient_reference,channel,idempotency_key,
      scheduled_at,status,template_key,payload)
      values(task_id,null,'task_assignee','rollback-'||other_id||'@gmail.com','email',fixture_tag||':terminal:'||queue_status,
        first_at,queue_status,'task_reminder','{}') returning id into delivery_id;
    terminal_ids:=array_append(terminal_ids,delivery_id);
  end loop;
  select jsonb_agg(to_jsonb(d) order by d.id) into terminal_before from public.notification_deliveries d where id=any(terminal_ids);
  insert into public.notification_deliveries(event_id,reminder_id,recipient_type,recipient_reference,channel,idempotency_key,
    scheduled_at,status,template_key,payload) values(series_id,sibling_reminder_id,'owner','rollback-'||owner_id||'@gmail.com','email',
      fixture_tag||':sibling',first_at+interval '7 days','queued','meeting_reminder',jsonb_build_object('occurrence_id',sibling_id));

  selected:=jsonb_build_array(jsonb_build_object('entity','task','id',task_id),jsonb_build_object('entity','meeting','id',meeting_id));
  -- Direct RPC calls are rejected for all non-active-Admin account states.
  foreach actor in array array[owner_id,other_id,disabled_id,pending_id] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    execute 'set local role authenticated';
    begin perform public.admin_calendar_items(); raise exception 'non-admin listed calendar management'; exception when insufficient_privilege then null; end;
    begin perform public.admin_meeting_occurrences(series_id); raise exception 'non-admin listed managed appointments'; exception when insufficient_privilege then null; end;
    begin perform public.admin_trash_calendar_items(selected,'Rollback reason'); raise exception 'non-admin trashed items'; exception when insufficient_privilege then null; end;
    begin perform public.admin_cancel_meeting_occurrence(series_id,first_at,'Rollback reason'); raise exception 'non-admin cancelled appointment'; exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.admin_trash_calendar_items(selected,'Rollback reason'); raise exception 'missing subject trashed items'; exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.admin_calendar_items(text,uuid,text,timestamptz,timestamptz,integer,integer)','EXECUTE')
    or has_function_privilege('anon','public.admin_trash_calendar_items(jsonb,text)','EXECUTE')
    or has_function_privilege('anon','public.admin_meeting_occurrences(uuid)','EXECUTE')
    or has_function_privilege('anon','public.admin_cancel_meeting_occurrence(uuid,timestamptz,text)','EXECUTE') then
    raise exception 'anonymous Admin API access granted';
  end if;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  response:=public.admin_calendar_items('',owner_id,fixture_tag,created_at,created_at+interval '1 day',0,25);
  if (response->>'total_count')::integer<>31 or jsonb_array_length(response->'rows')<>25 then raise exception 'combined count/page is incomplete: %',response; end if;
  response:=public.admin_calendar_items('',owner_id,fixture_tag,created_at,created_at+interval '1 day',25,25);
  if (response->>'total_count')::integer<>31 or jsonb_array_length(response->'rows')<>6 then raise exception 'second page/count mismatch'; end if;
  response:=public.admin_calendar_items('meeting',owner_id,fixture_tag,created_at,created_at+interval '1 day',0,25);
  if (response->>'total_count')::integer<>3 then raise exception 'combined meeting filter mismatch'; end if;
  response:=public.admin_calendar_items('task',owner_id,fixture_tag||' selected',created_at,created_at+interval '1 day',0,25);
  if (response->>'total_count')::integer<>1 or response->'rows'->0->>'id'<>task_id::text then raise exception 'combined task/title filter mismatch'; end if;
  response:=public.admin_calendar_items('',owner_id,upper(task_id::text),created_at,created_at+interval '1 day',0,25);
  if (response->>'total_count')::integer<>1 or response->'rows'->0->>'id'<>task_id::text then raise exception 'case-insensitive UUID search mismatch'; end if;
  response:=public.admin_calendar_items('',owner_id,fixture_tag,created_at+interval '1 day',created_at+interval '2 days',0,25);
  if (response->>'total_count')::integer<>0 or response->'rows'<>'[]'::jsonb then raise exception 'exclusive upper date/count mismatch'; end if;
  response:=public.admin_calendar_items('',owner_id,fixture_tag,created_at,created_at+interval '1 day',100,25);
  if (response->>'total_count')::integer<>31 or response->'rows'<>'[]'::jsonb then raise exception 'empty out-of-range page lost count'; end if;
  begin perform public.admin_calendar_items('x'); raise exception 'invalid entity filter accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_calendar_items(target_limit=>101); raise exception 'unbounded page accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_calendar_items(target_offset=>-1); raise exception 'negative page accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_calendar_items(target_created_from=>created_at,target_created_to=>created_at); raise exception 'invalid date bounds accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_trash_calendar_items('[]','Rollback reason'); raise exception 'empty selection accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_trash_calendar_items(selected,'  '); raise exception 'blank reason accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_trash_calendar_items(selected,repeat('x',501)); raise exception 'oversized reason accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_trash_calendar_items(jsonb_build_array(jsonb_build_object('entity','task','id',task_id),
    jsonb_build_object('entity','meeting','id',gen_random_uuid())),'Rollback reason');
    raise exception 'partial missing-row batch accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_trash_calendar_items('[{"entity":"task","id":"invalid"}]','Rollback reason'); raise exception 'invalid item accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_trash_calendar_items((select jsonb_agg(jsonb_build_object('entity','task','id',task_id)) from generate_series(1,101)),'Rollback reason');
    raise exception 'oversized batch accepted'; exception when invalid_parameter_value then null; end;

  -- The internal flag alone does not turn ordinary Admin table writes into
  -- creator edits, and the legacy owner-only occurrence RPC stays owner-only.
  perform set_config('app.admin_calendar_trash',admin_id::text,true);
  update public.tasks set title='Unapproved Admin edit' where id=task_id;
  get diagnostics count_value=row_count;
  if count_value<>0 then raise exception 'Admin ordinary edit bypassed owner RLS'; end if;
  update public.tasks set deleted_at=now(),status='cancelled' where id=task_id;
  get diagnostics count_value=row_count;
  if count_value<>0 then raise exception 'client-set trash flag bypassed RLS'; end if;
  update public.events set title='Unapproved Admin edit' where id=meeting_id;
  get diagnostics count_value=row_count;
  if count_value<>0 then raise exception 'Admin ordinary Meeting edit bypassed owner RLS'; end if;
  begin perform public.cancel_meeting_occurrence(series_id,first_at); raise exception 'ordinary owner RPC gained Admin rights'; exception when insufficient_privilege then null; end;
  perform set_config('app.admin_calendar_trash','',true);

  response:=public.admin_meeting_occurrences(series_id);
  if jsonb_array_length(response)<>2 then raise exception 'appointment list mismatch'; end if;
  begin perform public.admin_cancel_meeting_occurrence(series_id,first_at,' '); raise exception 'blank occurrence reason accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_cancel_meeting_occurrence(kept_meeting_id,first_at,'Rollback reason'); raise exception 'nonrecurring Meeting occurrence cancelled'; exception when invalid_parameter_value then null; end;
  returned_id:=public.admin_cancel_meeting_occurrence(series_id,first_at,'Creator cannot delete this appointment');
  if returned_id<>occurrence_id then raise exception 'wrong appointment cancelled'; end if;
  returned_id:=public.admin_cancel_meeting_occurrence(series_id,first_at,'Retry must be idempotent');
  if returned_id<>occurrence_id then raise exception 'appointment retry changed id'; end if;
  response:=public.admin_meeting_occurrences(series_id);
  if jsonb_array_length(response)<>1 or response->0->>'id'<>sibling_id::text then raise exception 'individual cancel changed sibling'; end if;
  execute 'reset role';
  if not exists(select 1 from public.event_occurrences where id=occurrence_id and status='cancelled' and override_payload->>'cancelled_individually'='true')
    or not exists(select 1 from public.event_occurrences where id=sibling_id and status='scheduled') then raise exception 'occurrence scope not retained'; end if;
  if exists(select 1 from public.notification_deliveries where id=any(occurrence_delivery_ids) and status<>'skipped') then raise exception 'cancelled appointment still has active delivery'; end if;
  if not exists(select 1 from public.notification_deliveries where idempotency_key=fixture_tag||':sibling' and status='queued')
    or not exists(select 1 from public.reminders where id=sibling_reminder_id and status='scheduled') then raise exception 'sibling reminders changed'; end if;
  if not exists(select 1 from public.reminders where id=reminder_id and status='cancelled') then raise exception 'selected occurrence reminder remains'; end if;
  if (select count(*) from public.notification_deliveries where event_id=series_id and template_key='meeting_occurrence_cancelled')<>1 then raise exception 'cancellation notice missing or duplicate'; end if;
  if (select count(*) from public.audit_logs where actor_user_id=admin_id and action='ADMIN_MEETING_OCCURRENCE_CANCELLED' and entity_id=occurrence_id::text)<>1 then raise exception 'Admin appointment audit missing or duplicated'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.refresh_meeting_occurrences(series_id);
  if not exists(select 1 from public.event_occurrences where id=occurrence_id and status='cancelled') then raise exception 'refresh resurrected Admin cancellation'; end if;
  insert into public.event_occurrences(event_id,occurrence_key,start_datetime)
    values(series_id,first_at-interval '30 days',first_at-interval '30 days') returning id into past_occurrence_id;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  begin perform public.admin_cancel_meeting_occurrence(series_id,first_at-interval '30 days','Rollback reason'); raise exception 'past occurrence cancellation accepted'; exception when invalid_parameter_value then null; end;
  if not exists(select 1 from public.event_occurrences where id=past_occurrence_id and status='scheduled') then raise exception 'past occurrence mutated by rejected cancellation'; end if;
  count_value:=public.admin_trash_calendar_items(selected||jsonb_build_array(jsonb_build_object('entity','task','id',task_id)),'  Creator cannot delete these items  ');
  if count_value<>2 then raise exception 'duplicate selection counted or mutated twice'; end if;
  response:=public.admin_calendar_items('',owner_id,fixture_tag,created_at,created_at+interval '1 day',0,100);
  if (response->>'total_count')::integer<>29 or exists(select 1 from jsonb_array_elements(response->'rows') r where r->>'id' in(task_id::text,meeting_id::text))
    then raise exception 'trashed items remain in Admin list'; end if;
  begin perform public.admin_trash_calendar_items(selected,'Retry'); raise exception 'already trashed batch accepted'; exception when invalid_parameter_value then null; end;
  count_value:=public.admin_trash_calendar_items(jsonb_build_array(jsonb_build_object('entity','meeting','id',series_id)),'Creator cannot delete whole series');
  if count_value<>1 then raise exception 'series counted per occurrence'; end if;
  begin perform public.admin_meeting_occurrences(series_id); raise exception 'trashed series occurrences still manageable'; exception when invalid_parameter_value then null; end;
  execute 'reset role';
  if not exists(select 1 from public.tasks where id=task_id and deleted_at is not null and status='cancelled')
    or not exists(select 1 from public.events where id=meeting_id and deleted_at is not null and status='scheduled')
    or not exists(select 1 from public.events where id=series_id and deleted_at is not null) then raise exception 'soft-trash semantics mismatch'; end if;
  if exists(select 1 from public.notification_deliveries where id=any(nonterminal_ids) and (status<>'skipped' or next_attempt_at is not null)) then raise exception 'old queued/retry/deferred/processing job remains'; end if;
  if (select jsonb_agg(to_jsonb(d) order by d.id) from public.notification_deliveries d where id=any(terminal_ids)) is distinct from terminal_before then raise exception 'terminal delivery history modified'; end if;
  if exists(select 1 from public.task_reminders r where r.task_id=fixture.task_id and status in('scheduled','processing','deferred_quota')) then raise exception 'Task reminders not stopped'; end if;
  if exists(select 1 from public.reminders where event_id in(meeting_id,series_id) and status in('scheduled','processing')) then raise exception 'Meeting reminders not stopped'; end if;
  if not exists(select 1 from public.task_reminders r where r.task_id=fixture.task_id and r.status='completed')
    or not exists(select 1 from public.reminders r where r.event_id=meeting_id and r.status='completed') then raise exception 'terminal reminder history modified'; end if;
  if not exists(select 1 from public.notification_deliveries d where d.task_id=fixture.task_id and template_key='task_cancelled' and status='queued') then raise exception 'existing Task cancellation confirmation suppressed'; end if;
  if not exists(select 1 from public.task_attachments a where a.task_id=fixture.task_id)
    or not exists(select 1 from public.attachments a where a.event_id=meeting_id) then raise exception 'attachments deleted before retention'; end if;
  if not exists(select 1 from public.tasks where id=kept_task_id and deleted_at is null and status='pending')
    or not exists(select 1 from public.events where id=kept_meeting_id and deleted_at is null and status='scheduled') then raise exception 'unselected entities changed'; end if;
  if (select count(*) from public.audit_logs where actor_user_id=admin_id and action in('ADMIN_TASK_TRASHED','ADMIN_MEETING_TRASHED')
    and entity_id in(task_id::text,meeting_id::text,series_id::text) and metadata->>'reason' like 'Creator cannot delete%')<>3 then raise exception 'Admin entity audit missing'; end if;

  -- Existing completed Tasks and the dormant legacy Task series contract are
  -- retained: only future pending children cascade when a series root is trashed.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,status,completed_at)
    values(owner_id,'internal',owner_id,fixture_tag||' completed task',(first_at at time zone 'Asia/Bangkok')::date,'completed',now()) returning id into completed_task_id;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,recurrence_rule)
    values(owner_id,'internal',owner_id,fixture_tag||' legacy task',(first_at at time zone 'Asia/Bangkok')::date,'FREQ=DAILY') returning id into legacy_id;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,recurrence_series_id)
    values(owner_id,'internal',owner_id,fixture_tag||' future child',(first_at at time zone 'Asia/Bangkok')::date+1,legacy_id) returning id into future_child_id;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,recurrence_series_id)
    values(owner_id,'internal',owner_id,fixture_tag||' past child',(first_at at time zone 'Asia/Bangkok')::date+2,legacy_id) returning id into past_child_id;
  update public.tasks set due_date=current_date-2 where id=past_child_id;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date,recurrence_series_id,status,completed_at)
    values(owner_id,'internal',owner_id,fixture_tag||' completed child',(first_at at time zone 'Asia/Bangkok')::date+3,legacy_id,'completed',now()) returning id into completed_child_id;
  insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,status)
    values(future_child_id,'due',first_at,true,'scheduled'),(past_child_id,'due',first_at,true,'scheduled'),(completed_child_id,'due',first_at,true,'completed');
  insert into public.notification_deliveries(task_id,recipient_type,recipient_reference,channel,idempotency_key,scheduled_at,status,template_key,payload)
    values(future_child_id,'task_assignee','rollback-'||owner_id||'@gmail.com','email',fixture_tag||':future-child',first_at,'queued','task_reminder','{}'),
      (past_child_id,'task_assignee','rollback-'||owner_id||'@gmail.com','email',fixture_tag||':past-child',first_at,'queued','task_reminder','{}'),
      (completed_child_id,'task_assignee','rollback-'||owner_id||'@gmail.com','email',fixture_tag||':completed-child',first_at,'queued','task_reminder','{}');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  response:=public.admin_calendar_items('task',owner_id,legacy_id::text);
  if (response->>'total_count')::integer<>1 or response->'rows'->0->>'recurring'<>'true' then raise exception 'legacy Task root recurrence hidden'; end if;
  count_value:=public.admin_trash_calendar_items(jsonb_build_array(jsonb_build_object('entity','task','id',legacy_id),
    jsonb_build_object('entity','task','id',completed_task_id)),'Creator cannot delete legacy/completed Task');
  if count_value<>2 then raise exception 'legacy root/completed Task trash count mismatch'; end if;
  execute 'reset role';
  if not exists(select 1 from public.tasks where id=completed_task_id and status='cancelled' and deleted_at is not null and completed_at is null)
    or not exists(select 1 from public.tasks where id=future_child_id and status='cancelled' and deleted_at is not null)
    or not exists(select 1 from public.tasks where id=past_child_id and status='pending' and deleted_at is null)
    or not exists(select 1 from public.tasks where id=completed_child_id and status='completed' and deleted_at is null) then raise exception 'legacy child/completed Task semantics changed'; end if;
  if not exists(select 1 from public.notification_deliveries where idempotency_key=fixture_tag||':future-child' and status='skipped')
    or not exists(select 1 from public.notification_deliveries where idempotency_key=fixture_tag||':past-child' and status='queued')
    or not exists(select 1 from public.notification_deliveries where idempotency_key=fixture_tag||':completed-child' and status='queued')
    or not exists(select 1 from public.task_reminders r where r.task_id=future_child_id and status='cancelled')
    or not exists(select 1 from public.task_reminders r where r.task_id=past_child_id and status='scheduled') then raise exception 'legacy child job scope changed'; end if;

  -- Owner visibility/ordinary deletion still works; shared active members do
  -- not see trashed records. No owner rights were transferred to the Admin.
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.tasks where id=task_id) or exists(select 1 from public.events where id=meeting_id) then raise exception 'trashed records visible to unrelated member'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  execute 'set local role authenticated';
  if not exists(select 1 from public.tasks where id=task_id) then raise exception 'owner Trash visibility lost'; end if;
  update public.tasks set title=fixture_tag||' owner can edit' where id=kept_task_id;
  get diagnostics count_value=row_count;
  if count_value<>1 then raise exception 'ordinary owner Task editing regressed'; end if;
  update public.tasks set deleted_at=now(),status='cancelled' where id=kept_task_id;
  get diagnostics count_value=row_count;
  if count_value<>1 then raise exception 'ordinary owner Task trash regressed'; end if;
  update public.events set deleted_at=now() where id=kept_meeting_id;
  get diagnostics count_value=row_count;
  if count_value<>1 then raise exception 'ordinary owner Meeting trash regressed'; end if;
  execute 'reset role';
end;
$$;
select 'PASS: active Admin scoped list/trash/occurrence RPCs; atomic capped batches; owner policies retained; selected jobs stopped; cancellation notices, documents and terminal history preserved' as result;
rollback;
