-- Run after the migration; every test row and queued email is rolled back.
begin;
do $$
declare creator public.profiles; meeting_id uuid; v_task_id uuid; external_task_id uuid; actual integer;
begin
  select * into creator from public.profiles where status = 'active' order by created_at limit 1;
  if creator.id is null then raise exception 'test needs an active profile'; end if;
  perform set_config('request.jwt.claim.sub', creator.id::text, true);
  insert into public.events(owner_user_id,title,start_datetime,suppress_guest_notifications)
    values(creator.id,'Creation confirmation rollback test',now()+interval '3 days',true) returning id into meeting_id;
  insert into public.event_guests(event_id,email) values(meeting_id,creator.email),(meeting_id,'creation-test@example.com');
  perform public.queue_creation_confirmation(meeting_id, null);
  update public.events set suppress_guest_notifications=false where id=meeting_id;
  perform public.queue_meeting_initial_notifications(meeting_id);
  perform public.queue_meeting_initial_notifications(meeting_id);
  perform public.queue_creation_confirmation(meeting_id, null);
  select count(*) into actual from public.notification_deliveries where event_id=meeting_id and recipient_reference=lower(btrim(creator.email));
  if actual <> 1 then raise exception 'Meeting creator got % emails, expected 1', actual; end if;
  select count(*) into actual from public.notification_deliveries where event_id=meeting_id and template_key='meeting_guest_added';
  if actual <> 1 then raise exception 'Other Meeting guest got % invitations, expected 1', actual; end if;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date)
    values(creator.id,'internal',creator.id,'Task creation rollback test',current_date+3) returning id into v_task_id;
  insert into public.task_internal_recipients(task_id,user_id) values(v_task_id,creator.id) on conflict do nothing;
  perform public.queue_creation_confirmation(null,v_task_id);
  update public.tasks set notification_requested_at=now() where id=v_task_id;
  perform public.queue_creation_confirmation(null,v_task_id);
  perform public.queue_notification(null,v_task_id,'task_assignee',creator.email,'task_assigned','{}',now()+interval '1 second');
  select count(*) into actual from public.notification_deliveries d where d.task_id=v_task_id and d.template_key='task_created';
  if actual <> 1 then raise exception 'Task creator got % confirmations, expected 1', actual; end if;
  select count(*) into actual from public.notification_deliveries d where d.task_id=v_task_id and d.template_key='task_assigned';
  if actual <> 0 then raise exception 'Self-assigned creator also got an invitation'; end if;
  perform public.queue_notification(null,v_task_id,'task_assignee','creation-test@example.com','task_assigned','{}');
  perform public.queue_notification(null,v_task_id,'task_assignee','creation-test@example.com','task_assigned','{}',now()+interval '1 second');
  select count(*) into actual from public.notification_deliveries d where d.task_id=v_task_id and d.template_key='task_assigned';
  if actual <> 1 then raise exception 'Other Task assignee got % invitations, expected 1',actual; end if;
  insert into public.tasks(creator_user_id,assignee_type,external_assignee_email,title,due_date)
    values(creator.id,'external','creation-test@gmail.com','External creation rollback test',current_date+3) returning id into external_task_id;
  perform public.queue_creation_confirmation(null,external_task_id);
  select count(*) into actual from public.notification_deliveries d where d.task_id=external_task_id and d.template_key='task_created';
  if actual <> 1 then raise exception 'External-only Task is missing creator confirmation'; end if;
  insert into public.task_reminders(task_id,reminder_key,scheduled_at) values
    (v_task_id,'1_day',now()-interval '1 day'),(v_task_id,'due',now()+interval '3 days');
  select count(*) into actual from public.task_reminders r where r.task_id=v_task_id and r.status='scheduled';
  if actual <> 1 then raise exception 'Past Task reminder was not cancelled'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.queue_creation_confirmation(null,v_task_id);
    raise exception 'Non-creator was allowed to queue confirmation';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',creator.id::text,true);
end;
$$;
select 'PASS: one creator email, other invitations preserved, retries deduplicated, past reminders skipped, creator authorization enforced' as result;
rollback;
