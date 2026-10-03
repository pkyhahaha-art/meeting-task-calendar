-- Synthetic users, devices, Tasks and deliveries roll back. Nothing is sent.
begin;
do $$
declare creator_id uuid:=gen_random_uuid(); assignee_id uuid:=gen_random_uuid(); unpaired_id uuid:=gen_random_uuid();
  v_task_id uuid; external_task_id uuid; unpaired_task_id uuid; actual integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (creator_id,'rollback-'||creator_id||'@gmail.com','{"full_name":"Rollback Task Creator"}'),
    (assignee_id,'rollback-'||assignee_id||'@gmail.com','{"full_name":"Rollback Task Assignee"}'),
    (unpaired_id,'rollback-'||unpaired_id||'@gmail.com','{"full_name":"Rollback Unpaired"}');
  update public.profiles set status='active' where id in(creator_id,assignee_id,unpaired_id);
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth) values
    (creator_id,'https://web.push.apple.com/rollback-'||creator_id,'fixture','fixture'),
    (creator_id,'https://fcm.googleapis.com/rollback-'||creator_id,'fixture','fixture'),
    (assignee_id,'https://fcm.googleapis.com/rollback-'||assignee_id,'fixture','fixture');
  perform set_config('request.jwt.claim.sub',creator_id::text,true);
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,description,due_date,due_time)
    values(creator_id,'internal',assignee_id,'Task creator Push rollback','Saved task details',current_date+3,'09:00')
    returning id into v_task_id;
  insert into public.task_internal_recipients(task_id,user_id) values(v_task_id,assignee_id) on conflict do nothing;
  insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,channel_line)
    values(v_task_id,'due',now()+interval '3 days',true,true);
  perform public.queue_creation_confirmation(null,v_task_id);
  actual:=public.queue_task_creation_mobile_confirmation(v_task_id);
  if actual<>2 then raise exception 'Expected two creator devices, got %',actual; end if;
  if public.queue_task_creation_mobile_confirmation(v_task_id)<>0 then raise exception 'Retry duplicated creator Push'; end if;
  if exists(select 1 from public.notification_deliveries d where d.task_id=v_task_id and d.channel='push'
    and (d.recipient_type<>'task_creator' or d.template_key<>'task_created'
      or d.payload->>'push_user_id'<>creator_id::text
      or d.payload->>'title'<>'Task creator Push rollback'
      or d.payload->>'description'<>'Saved task details'
      or d.scheduled_at<>now()
      or not exists(select 1 from public.mobile_push_subscriptions s where s.id::text=d.recipient_reference and s.user_id=creator_id)))
    then raise exception 'Creator confirmation leaked to assignee or incorrect payload/time'; end if;
  if (select count(*) from public.notification_deliveries d where d.task_id=v_task_id and d.channel='email')<>1
    then raise exception 'Push changed creator Email confirmation'; end if;
  if not exists(select 1 from public.task_reminders r where r.task_id=v_task_id and r.status='scheduled'
    and r.scheduled_at=now()+interval '3 days' and r.channel_line and r.channel_email)
    then raise exception 'Creation Push changed the future reminder'; end if;

  -- The creator receives a confirmation even when no assignee has an account.
  insert into public.tasks(creator_user_id,assignee_type,external_assignee_email,title,due_date)
    values(creator_id,'external','rollback-task@gmail.com','External assignee creator Push',current_date+3)
    returning id into external_task_id;
  if public.queue_task_creation_mobile_confirmation(external_task_id)<>2 then raise exception 'External-only Task lost creator Push'; end if;
  update public.tasks set status='cancelled' where id=external_task_id;
  if public.queue_task_creation_mobile_confirmation(external_task_id)<>0 then raise exception 'Cancelled Task notified'; end if;
  update public.tasks set deleted_at=now() where id=v_task_id;
  if public.queue_task_creation_mobile_confirmation(v_task_id)<>0 then raise exception 'Deleted Task notified'; end if;

  perform set_config('request.jwt.claim.sub',assignee_id::text,true);
  begin
    perform public.queue_task_creation_mobile_confirmation(v_task_id);
    raise exception 'Assignee could notify creator devices';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',creator_id::text,true);
  update public.profiles set status='disabled' where id=creator_id;
  begin
    perform public.queue_task_creation_mobile_confirmation(external_task_id);
    raise exception 'Inactive creator could send Push';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub',unpaired_id::text,true);
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date)
    values(unpaired_id,'internal',assignee_id,'Unpaired creator',current_date+3) returning id into unpaired_task_id;
  if public.queue_task_creation_mobile_confirmation(unpaired_task_id)<>0 then raise exception 'Unpaired creator used assignee device'; end if;
  if has_function_privilege('anon','public.queue_task_creation_mobile_confirmation(uuid)','execute')
    then raise exception 'Anonymous users may queue creator confirmations'; end if;
end;
$$;
select 'PASS: creator-only immediate Push, device isolation, deduplication, external assignees, active creator authorization, Email and future reminders preserved' as result;
rollback;
