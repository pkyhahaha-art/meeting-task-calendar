-- Every fixture and queued message is uncommitted and rolled back; no Push is sent.
begin;
do $$
declare creator public.profiles; meeting_id uuid; device_id uuid; result jsonb; actual integer; expected integer;
begin
  select * into creator from public.profiles where status='active' order by created_at limit 1;
  if creator.id is null then raise exception 'test requires an active profile'; end if;
  perform set_config('request.jwt.claim.sub',creator.id::text,true);
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth,device_name)
    values(creator.id,'https://web.push.apple.com/rollback-'||gen_random_uuid(),'fixture-public-key','fixture-secret-1234567890','Rollback device') returning id into device_id;
  select public.get_mobile_device_status(s.endpoint,'wrong-secret-1234567890') into result from public.mobile_push_subscriptions s where s.id=device_id;
  if (result->>'paired')::boolean then raise exception 'wrong device secret was accepted'; end if;
  select public.get_mobile_device_status(s.endpoint,s.auth) into result from public.mobile_push_subscriptions s where s.id=device_id;
  if not (result->>'paired')::boolean or result->>'subscription_id' <> device_id::text or result->>'user_id' <> creator.id::text then raise exception 'valid device did not restore'; end if;
  if result ? 'email' or result ? 'auth' or result ? 'endpoint' then raise exception 'restore exposed unnecessary credentials'; end if;
  insert into public.events(owner_user_id,title,start_datetime,recurrence_rule,recurrence_count,mobile_notifications_enabled)
    values(creator.id,'Mobile rollback test',now()+interval '2 days','FREQ=DAILY',3,true) returning id into meeting_id;
  perform public.queue_meeting_mobile_notification(meeting_id);
  perform public.queue_meeting_mobile_notification(meeting_id);
  select count(*) into expected from public.mobile_push_subscriptions where user_id=creator.id and endpoint like 'https://%';
  select count(*) into actual from public.notification_deliveries d where d.event_id=meeting_id and d.channel='push' and d.template_key='meeting_created';
  if actual<>expected then raise exception 'expected % own devices, got % pushes',expected,actual; end if;
  if exists(select 1 from public.notification_deliveries d where d.event_id=meeting_id and d.channel='push' and d.payload->>'push_user_id'<>creator.id::text) then raise exception 'Push was queued for another user'; end if;
  update public.events set notification_requested_at=now() where id=meeting_id;
  perform public.queue_meeting_mobile_notification(meeting_id,false);
  perform public.queue_meeting_mobile_notification(meeting_id,false);
  select count(*) into actual from public.notification_deliveries d where d.event_id=meeting_id and d.channel='push' and d.template_key='meeting_updated';
  if actual<>expected then raise exception 'update Push retry was not deduplicated'; end if;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(meeting_id,3,'day',now()-interval '2 days',true,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  if exists(select 1 from public.reminders where event_id=meeting_id and scheduled_at<now() and status='scheduled') then raise exception 'past recurrence reminder would be sent immediately'; end if;
  if not exists(select 1 from public.reminders where event_id=meeting_id and scheduled_at>now() and status='scheduled' and channel_line) then raise exception 'future recurrence reminder was lost'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.queue_meeting_mobile_notification(meeting_id);
    raise exception 'non-creator could queue another user Push';
  exception when insufficient_privilege then null;
  end;
  if not has_table_privilege('service_role','public.reminders','SELECT') then raise exception 'worker cannot read reminders'; end if;
  if has_table_privilege('anon','public.mobile_push_subscriptions','SELECT') then raise exception 'anonymous subscription access widened'; end if;
end;
$$;
select 'PASS: device restores with its Push secret; only creator devices notified once; future recurring reminders retained; past reminders skipped; anonymous table access remains closed' as result;
rollback;
