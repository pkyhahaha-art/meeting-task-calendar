begin;
do $$
declare creator uuid:=gen_random_uuid(); assignee uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  v_task uuid; requested timestamptz:=now(); actual integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (creator,'rollback-'||creator||'@gmail.com','{"full_name":"Update Creator"}'),
    (assignee,'rollback-'||assignee||'@gmail.com','{"full_name":"Update Assignee"}'),
    (outsider,'rollback-'||outsider||'@gmail.com','{"full_name":"Unrelated Member"}');
  update public.profiles set status='active' where id in (creator,assignee,outsider);
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth) values
    (creator,'https://web.push.apple.com/rollback-'||creator,'fixture','fixture'),
    (assignee,'https://fcm.googleapis.com/rollback-'||assignee,'fixture','fixture'),
    (outsider,'https://fcm.googleapis.com/rollback-'||outsider,'fixture','fixture');
  perform set_config('request.jwt.claim.sub',creator::text,true);
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,affiliation,description,due_date,notification_requested_at)
    values(creator,'internal',assignee,'Updated Task','Task affiliation','Updated details',current_date+5,requested) returning id into v_task;
  insert into public.task_internal_recipients(task_id,user_id) values(v_task,creator),(v_task,assignee) on conflict do nothing;
  insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,channel_line)
    values(v_task,'due',now()+interval '5 days',true,true);
  actual:=public.queue_task_update_mobile_notifications(v_task,requested);
  if actual<>2 then raise exception 'Expected creator and assignee devices, got %',actual; end if;
  if public.queue_task_update_mobile_notifications(v_task,requested)<>0 then raise exception 'Retry duplicated Push'; end if;
  if exists(select 1 from public.notification_deliveries d where d.task_id=v_task and d.channel='push'
    and (d.template_key<>'task_updated' or d.payload->>'push_user_id' not in(creator::text,assignee::text)
      or d.payload->>'title'<>'Updated Task' or d.payload->>'affiliation'<>'Task affiliation'))
    then raise exception 'Incorrect recipient or update details'; end if;
  if not exists(select 1 from public.task_reminders where task_id=v_task and status='scheduled' and scheduled_at=requested+interval '5 days')
    then raise exception 'Update Push changed the due reminder'; end if;
  if public.queue_task_update_mobile_notifications(v_task,requested+interval '1 second')<>0
    then raise exception 'Uncommitted request queued'; end if;
  perform set_config('request.jwt.claim.sub',assignee::text,true);
  begin
    perform public.queue_task_update_mobile_notifications(v_task,requested);
    raise exception 'Assignee could queue a creator update';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',creator::text,true);
  update public.profiles set status='disabled' where id=assignee;
  requested:=requested+interval '1 minute';
  update public.tasks set notification_requested_at=requested where id=v_task;
  if public.queue_task_update_mobile_notifications(v_task,requested)<>1 then raise exception 'Disabled assignee got Push'; end if;
  update public.tasks set status='completed' where id=v_task;
  if public.queue_task_update_mobile_notifications(v_task,requested)<>0 then raise exception 'Completed Task queued'; end if;
  if has_function_privilege('anon','public.queue_task_update_mobile_notifications(uuid,timestamptz)','execute')
    then raise exception 'Anonymous caller can queue updates'; end if;
end;
$$;
select 'PASS: Task update Push, creator/assignees, idempotency, authorization and future reminders' as result;
rollback;
