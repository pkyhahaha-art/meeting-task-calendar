-- Synthetic fixture; transaction rolls back and does not dispatch notifications.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid();
  meeting_id uuid; past_meeting uuid; first_at timestamptz := now() + interval '14 days';
  first_occurrence uuid; next_at timestamptz; next_occurrence uuid;
  member_email text := 'rollback-' || member_id::text || '@gmail.com';
begin
  if not has_function_privilege('authenticated','public.meeting_join_server_time()','execute')
    or has_function_privilege('anon','public.meeting_join_server_time()','execute')
    or public.meeting_join_server_time() <> now() then
    raise exception 'server time function privilege or time mismatch';
  end if;
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (owner_id,'rollback-' || owner_id::text || '@gmail.com',now(),'{}'::jsonb),
    (member_id,member_email,now(),'{}'::jsonb);
  update public.profiles set status='active',email_verified_at=now() where id in (owner_id,member_id);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,
    suppress_guest_notifications) values
    (owner_id,'Self-join rollback',first_at,first_at+interval '1 hour','FREQ=DAILY;INTERVAL=1',3,true)
    returning id into meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select id into first_occurrence from public.event_occurrences
    where event_id=meeting_id order by start_datetime limit 1;
  select id,start_datetime into next_occurrence,next_at from public.event_occurrences
    where event_id=meeting_id and id<>first_occurrence order by start_datetime limit 1;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  if not public.join_meeting_as_attendee(meeting_id,next_at,'occurrence') then
    raise exception 'first occurrence join must succeed'; end if;
  if public.join_meeting_as_attendee(meeting_id,next_at,'occurrence') then
    raise exception 'repeat occurrence join must be idempotent'; end if;
  if (select count(*) from public.event_guests where event_id=meeting_id and occurrence_id=first_occurrence)<>0
    or (select count(*) from public.event_guests where event_id=meeting_id and occurrence_id=next_occurrence)<>1 then
    raise exception 'single appointment join leaked to another date'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.event_occurrence_guest_exclusions(occurrence_id,email) values(first_occurrence,member_email);
  insert into public.event_guests(event_id,occurrence_id,email,revoked_at) values(meeting_id,first_occurrence,member_email,now());
  update public.events set initial_notification_requested_at=now(),suppress_guest_notifications=false,email_notifications_enabled=true where id=meeting_id;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  if not public.join_meeting_as_attendee(meeting_id,next_at,'series') then
    raise exception 'series expansion must succeed'; end if;
  if not exists(select 1 from public.notification_deliveries where event_id=meeting_id and recipient_reference=member_email
    and template_key='meeting_guest_added' and payload->>'occurrence_id'=next_occurrence::text
    and (payload->>'start_datetime')::timestamptz=next_at) then
    raise exception 'self-join invitation must bind to the selected occurrence'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  delete from public.notification_deliveries where event_id=meeting_id and recipient_reference=member_email and template_key='meeting_guest_added';
  update public.events set initial_notification_requested_at=null where id=meeting_id;
  perform public.queue_meeting_initial_notifications(meeting_id);
  if not exists(select 1 from public.notification_deliveries where event_id=meeting_id and recipient_reference=member_email
    and template_key='meeting_guest_added' and payload->>'occurrence_id'=next_occurrence::text) then
    raise exception 'explicit initial invitation ignored future membership scope'; end if;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    values(member_id,'https://fixture.invalid/self-join/'||member_id::text,'fixture-p256dh','fixture-auth');
  update public.events set notification_requested_at=now(),mobile_notifications_enabled=true where id=meeting_id;
  perform public.queue_meeting_mobile_notification(meeting_id,false);
  if not exists(select 1 from public.notification_deliveries where event_id=meeting_id and channel='push'
    and payload->>'push_user_id'=member_id::text and payload->>'occurrence_id'=next_occurrence::text
    and (payload->>'start_datetime')::timestamptz=next_at) then
    raise exception 'future series mobile update missing scoped recipient or time'; end if;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  if public.join_meeting_as_attendee(meeting_id,next_at,'series') then
    raise exception 'repeat series join must be idempotent'; end if;
  if (select count(*) from public.event_guests where event_id=meeting_id and occurrence_id is null)<>1 then
    raise exception 'series guest row missing or duplicated'; end if;
  if (select self_join_from from public.event_guests where event_id=meeting_id and occurrence_id is null and email=member_email) is distinct from next_at then
    raise exception 'future series join cutoff missing'; end if;
  if exists(select 1 from public.occurrence_guest_emails(meeting_id,first_occurrence) where email=member_email)
    or exists(select 1 from public.occurrence_guest_emails(meeting_id,null) where email=member_email) then
    raise exception 'future series join changed earlier attendance'; end if;
  if not exists(select 1 from public.occurrence_guest_emails(meeting_id,next_occurrence) where email=member_email) then
    raise exception 'selected occurrence missing attendee'; end if;
  if exists(select 1 from public.event_occurrences occurrence where occurrence.event_id=meeting_id and occurrence.start_datetime>=next_at
    and not exists(select 1 from public.occurrence_guest_emails(meeting_id,occurrence.id) guest where guest.email=member_email)) then
    raise exception 'remaining occurrence missing attendee'; end if;
  -- Explicit earlier attendance survives a later series subscription.
  update public.event_guests set revoked_at=null where event_id=meeting_id and occurrence_id=first_occurrence and email=member_email;
  if not exists(select 1 from public.occurrence_guest_emails(meeting_id,first_occurrence) where email=member_email) then
    raise exception 'earlier explicit attendance was lost'; end if;
  delete from public.event_guests where event_id=meeting_id and occurrence_id=first_occurrence and email=member_email;
  -- Re-materializing and creating an additional earlier occurrence cannot backfill membership.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  if exists(select 1 from public.occurrence_guest_emails(meeting_id,first_occurrence) where email=member_email) then
    raise exception 'refresh resurrected historical membership'; end if;
  insert into public.event_occurrences(event_id,occurrence_key,start_datetime,status)
    values(meeting_id,first_at+interval '1 hour',first_at+interval '1 hour','scheduled') returning id into first_occurrence;
  if exists(select 1 from public.occurrence_guest_emails(meeting_id,first_occurrence) where email=member_email) then
    raise exception 'new earlier occurrence backfilled membership'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.update_meeting_occurrence_details(meeting_id,first_at,'','',array[member_email]);
  if not exists(select 1 from public.event_guests guest join public.event_occurrences occurrence on occurrence.id=guest.occurrence_id
    where guest.event_id=meeting_id and occurrence.occurrence_key=first_at and guest.email=member_email and guest.revoked_at is null) then
    raise exception 'owner explicit earlier appointment invite was lost because a later series row exists'; end if;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  if not public.join_meeting_as_attendee(meeting_id,first_at,'series') then
    raise exception 'joining an earlier future occurrence must expand series membership'; end if;
  if (select self_join_from from public.event_guests where event_id=meeting_id and occurrence_id is null and email=member_email) is distinct from first_at then
    raise exception 'series cutoff did not expand to the selected earlier future date'; end if;
  if public.join_meeting_as_attendee(meeting_id,first_at,'series') then
    raise exception 'expanded series retry must remain idempotent'; end if;
  update public.profiles set status='disabled' where id=member_id;
  begin
    perform public.join_meeting_as_attendee(meeting_id,next_at,'series');
    raise exception 'disabled member joined';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set status='active' where id=member_id;
  delete from public.event_guests where event_id=meeting_id;
  insert into public.event_occurrence_guest_exclusions(occurrence_id,email)
    values(next_occurrence,member_email);
  begin
    perform public.join_meeting_as_attendee(meeting_id,next_at,'occurrence');
    raise exception 'organizer exclusion was ignored';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.join_meeting_as_attendee(meeting_id,next_at,'series');
    raise exception 'series join ignored selected/future organizer exclusion';
  exception when insufficient_privilege then null;
  end;
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,suppress_guest_notifications)
    values(owner_id,'Past self-join rollback',now(),now()+interval '1 hour',true) returning id into past_meeting;
  begin
    perform public.join_meeting_as_attendee(past_meeting, now(), 'occurrence');
    raise exception 'past meeting joined';
  exception when invalid_parameter_value then
    if sqlerrm <> 'meeting_join_start_passed' then raise; end if;
  end;
  begin
    perform public.join_meeting_as_attendee(past_meeting, now()+interval '1 minute', 'occurrence');
    raise exception 'mismatched meeting joined';
  exception when invalid_parameter_value then
    if sqlerrm <> 'a future scheduled Meeting is required' then raise; end if;
  end;
  update public.event_occurrences set start_datetime=now() where id=next_occurrence;
  begin
    perform public.join_meeting_as_attendee(meeting_id,now(),'series');
    raise exception 'past occurrence joined';
  exception when invalid_parameter_value then
    if sqlerrm <> 'meeting_join_start_passed' then raise; end if;
  end;
end;
$$;
rollback;
