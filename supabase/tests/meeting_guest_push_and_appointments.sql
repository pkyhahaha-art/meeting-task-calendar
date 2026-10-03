-- All synthetic users, devices, appointments and queues roll back. Nothing sends.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  disabled_id uuid:=gen_random_uuid(); meeting_id uuid; moved_id uuid; appointment_id uuid; test_reminder_id uuid;
  owner_device uuid; member_device uuid; other_device uuid; fixture_email text;
  first_date date; first_at timestamptz; expected integer;
begin
  fixture_email:='rollback-'||member_id||'@gmail.com';
  insert into auth.users(id,email,raw_user_meta_data) values
    (owner_id,'rollback-'||owner_id||'@gmail.com','{"full_name":"Rollback Owner"}'),
    (member_id,fixture_email,'{"full_name":"Rollback Member"}'),
    (other_id,'rollback-'||other_id||'@gmail.com','{"full_name":"Rollback Other"}'),
    (disabled_id,'rollback-'||disabled_id||'@gmail.com','{"full_name":"Rollback Disabled"}');
  update public.profiles set status='active' where id in (owner_id,member_id,other_id);
  update public.profiles set status='disabled' where id=disabled_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth) values
    (owner_id,'https://web.push.apple.com/rollback-'||owner_id,'fixture','fixture') returning id into owner_device;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth) values
    (member_id,'https://fcm.googleapis.com/rollback-'||member_id,'fixture','fixture') returning id into member_device;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth) values
    (other_id,'https://fcm.googleapis.com/rollback-'||other_id,'fixture','fixture') returning id into other_device;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth) values
    (disabled_id,'https://fcm.googleapis.com/rollback-'||disabled_id,'fixture','fixture');
  if not public.meeting_mobile_recipients_available('{}') then raise exception 'paired organizer unavailable'; end if;
  delete from public.mobile_push_subscriptions where id=owner_device;
  if public.meeting_mobile_recipients_available('{}') then raise exception 'unpaired organizer enables checkbox'; end if;
  if not public.meeting_mobile_recipients_available(array['  '||upper(fixture_email)||'  ']) then raise exception 'paired attendee unavailable'; end if;
  if public.meeting_mobile_recipients_available(array['unregistered-rollback@gmail.com','rollback-'||disabled_id||'@gmail.com'])
    then raise exception 'disabled or unregistered attendee enables checkbox'; end if;
  insert into public.mobile_push_subscriptions(id,user_id,endpoint,p256dh,auth)
    values(owner_device,owner_id,'https://web.push.apple.com/rollback-'||owner_id,'fixture','fixture');
  first_date:=(now() at time zone 'Asia/Bangkok')::date;
  first_date:=first_date+((6-extract(isodow from first_date)::integer+7)%7)+7;
  first_at:=(first_date+time '09:00') at time zone 'Asia/Bangkok';
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,
    suppress_guest_notifications,mobile_notifications_enabled,email_notifications_enabled)
    values(owner_id,'Attendee Push rollback',first_at,first_at+interval '1 hour','FREQ=WEEKLY;BYDAY=TU,WE',4,true,true,true)
    returning id into meeting_id;
  insert into public.event_guests(event_id,email) values
    (meeting_id,'rollback-'||owner_id||'@gmail.com'),(meeting_id,upper(fixture_email)),
    (meeting_id,'unregistered-rollback@gmail.com'),(meeting_id,'rollback-'||disabled_id||'@gmail.com');
  perform public.queue_meeting_mobile_notification(meeting_id);
  perform public.queue_meeting_mobile_notification(meeting_id);
  if (select count(*) from public.notification_deliveries where event_id=meeting_id and channel='push')<>2 then
    raise exception 'creation must notify only organizer and active member once'; end if;
  if exists(select 1 from public.notification_deliveries where event_id=meeting_id and channel='push'
    and payload->>'push_user_id' not in(owner_id::text,member_id::text)) then raise exception 'uninvited Push'; end if;
  update public.events set mobile_notifications_enabled=false where id=meeting_id;
  if public.queue_meeting_mobile_notification(meeting_id)<>0 then raise exception 'opt-out ignored'; end if;
  update public.events set mobile_notifications_enabled=true where id=meeting_id;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(meeting_id,0,'minute',first_at,true,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  select id into appointment_id from public.event_occurrences where event_id=meeting_id and occurrence_key=first_at+interval '4 days';
  perform public.update_meeting_occurrence_details(meeting_id,first_at+interval '4 days','Only this appointment','Room 7',
    array['rollback-'||owner_id||'@gmail.com','rollback-'||other_id||'@gmail.com']);
  if (select array_agg(user_id order by user_id) from public.meeting_mobile_guest_users(meeting_id,appointment_id))
    is distinct from (select array_agg(value order by value) from unnest(array[owner_id,other_id]) value)
    then raise exception 'occurrence exclusions/additions ignored'; end if;
  if not exists(select 1 from public.events where id=meeting_id and description='' and location='') then raise exception 'occurrence edit changed series'; end if;
  select id into test_reminder_id from public.reminders where occurrence_id=appointment_id;
  update public.reminders set status='scheduled',scheduled_at=now() where id=test_reminder_id;
  if test_reminder_id is null or not exists(select 1 from public.reminders where id=test_reminder_id and status='scheduled' and channel_line and scheduled_at<=now()) then
    raise exception 'fixture reminder is not due: %', (select to_jsonb(r) from public.reminders r where id=test_reminder_id);
  end if;
  perform public.queue_due_line_reminders();
  perform public.queue_due_line_reminders();
  select count(*) into expected from public.notification_deliveries d where d.reminder_id=test_reminder_id and channel='push';
  if expected<>2 then raise exception 'scheduled reminder expected two Push, got %',expected; end if;
  if exists(select 1 from public.notification_deliveries d where d.reminder_id=test_reminder_id and channel='push'
    and (payload->>'push_user_id'=member_id::text or payload->>'description'<>'Only this appointment'))
    then raise exception 'scheduled reminder uses wrong guests/details'; end if;
  moved_id:=public.detach_meeting_occurrence(meeting_id,first_at+interval '4 days',first_at+interval '5 days',
    'Only this appointment','Room 7',array['rollback-'||other_id||'@gmail.com']);
  if public.detach_meeting_occurrence(meeting_id,first_at+interval '4 days',first_at+interval '5 days','Only this appointment',
    'Room 7',array['rollback-'||other_id||'@gmail.com'])<>moved_id then raise exception 'move retry duplicates Meeting'; end if;
  if not exists(select 1 from public.events where id=moved_id and recurrence_rule is null and recurrence_count is null
    and recurrence_until is null and start_datetime=first_at+interval '5 days' and end_datetime=start_datetime+interval '1 hour')
    then raise exception 'moved appointment is not independent/non-recurring'; end if;
  if not exists(select 1 from public.event_occurrences where id=appointment_id and status='cancelled')
    or exists(select 1 from public.notification_deliveries d where d.reminder_id=test_reminder_id and status in('queued','retry'))
    then raise exception 'original moved appointment could still notify'; end if;
  if not exists(select 1 from public.reminders where event_id=moved_id and scheduled_at=first_at+interval '5 days'
    and channel_email and channel_line) then raise exception 'moved reminder lost'; end if;
  perform public.cancel_meeting_occurrence(meeting_id,first_at+interval '3 days');
  perform public.refresh_meeting_occurrences(meeting_id);
  if (select count(*) from public.event_occurrences where event_id=meeting_id and status='scheduled')<>2
    then raise exception 'individual deletion changed other dates or reappeared'; end if;
  perform public.cancel_meeting_occurrence(meeting_id,first_at);
  delete from public.reminders where event_id=meeting_id;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(meeting_id,0,'minute',first_at,true,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  if exists(select 1 from public.reminders where event_id=meeting_id and status='scheduled' and
    (occurrence_id is null or occurrence_id in (select id from public.event_occurrences where event_id=meeting_id and status='cancelled')))
    then raise exception 'series edit recreated a cancelled appointment reminder'; end if;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  begin
    perform public.cancel_meeting_occurrence(meeting_id,first_at+interval '10 days');
    raise exception 'non-owner cancelled another Meeting';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.meeting_mobile_recipients_available(text[],uuid)','EXECUTE')
    or has_table_privilege('anon','public.mobile_push_subscriptions','SELECT') then raise exception 'anonymous access widened'; end if;
end;
$$;
select 'PASS: invited active employees only; devices deduplicate; occurrence guests/details respected; individual cancellation persists; move creates one independent Meeting; access checks retained' as result;
rollback;
