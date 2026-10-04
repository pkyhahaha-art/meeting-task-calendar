-- Synthetic records and queues are rolled back; no provider is called.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  disabled_id uuid:=gen_random_uuid(); meeting_id uuid; appointment_id uuid; moved_id uuid; fixture_reminder_id uuid;
  owner_email text; member_email text; other_email text; external_email text;
  first_date date; first_at timestamptz; cancel_at timestamptz; move_at timestamptz;
begin
  owner_email:='rollback-'||owner_id||'@gmail.com'; member_email:='rollback-'||member_id||'@gmail.com';
  other_email:='rollback-'||other_id||'@gmail.com'; external_email:='rollback-external-'||owner_id||'@gmail.com';
  insert into auth.users(id,email,raw_user_meta_data) values
    (owner_id,owner_email,'{"full_name":"Rollback Owner"}'),
    (member_id,member_email,'{"full_name":"Rollback Member"}'),
    (other_id,other_email,'{"full_name":"Rollback Other"}'),
    (disabled_id,'rollback-'||disabled_id||'@gmail.com','{"full_name":"Rollback Disabled"}');
  update public.profiles set status='active' where id in(owner_id,member_id,other_id);
  update public.profiles set status='disabled' where id=disabled_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    select id,'https://fcm.googleapis.com/rollback-'||id,'fixture','fixture'
      from public.profiles where id in(owner_id,member_id,other_id,disabled_id);
  first_date:=(now() at time zone 'Asia/Bangkok')::date;
  first_date:=first_date+((6-extract(isodow from first_date)::integer+7)%7)+7;
  first_at:=(first_date+time '09:00') at time zone 'Asia/Bangkok';
  cancel_at:=first_at+interval '3 days'; move_at:=first_at+interval '4 days';
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,
    suppress_guest_notifications,email_notifications_enabled,mobile_notifications_enabled)
    values(owner_id,'Appointment notices rollback',first_at,first_at+interval '1 hour',
      'FREQ=WEEKLY;BYDAY=TU,WE',4,true,true,true) returning id into meeting_id;
  insert into public.event_guests(event_id,email) values
    (meeting_id,owner_email),(meeting_id,member_email),(meeting_id,external_email),
    (meeting_id,'rollback-'||disabled_id||'@gmail.com');
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(meeting_id,0,'minute',first_at,true,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  perform public.update_meeting_occurrence_details(meeting_id,cancel_at,'Specific agenda','Room 7',
    array[owner_email,other_email,external_email]);
  select id into appointment_id from public.event_occurrences where event_id=meeting_id and occurrence_key=cancel_at;
  select id into fixture_reminder_id from public.reminders where event_id=meeting_id and occurrence_id=appointment_id;
  insert into public.notification_deliveries(event_id,reminder_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload) values(meeting_id,fixture_reminder_id,'owner',owner_email,'email',
      'rollback-reminder-'||appointment_id,now(),'meeting_reminder','{}');
  perform public.cancel_meeting_occurrence(meeting_id,cancel_at);
  perform public.cancel_meeting_occurrence(meeting_id,cancel_at);
  if (select count(*) from public.notification_deliveries where event_id=meeting_id
    and template_key='meeting_occurrence_cancelled' and channel='email')<>3 then
    raise exception 'cancellation must email current occurrence guests and owner once'; end if;
  if (select count(*) from public.notification_deliveries where event_id=meeting_id
    and template_key='meeting_occurrence_cancelled' and channel='push')<>2 then
    raise exception 'cancellation must Push current active invited employees and owner once'; end if;
  if exists(select 1 from public.notification_deliveries where event_id=meeting_id and template_key='meeting_occurrence_cancelled'
    and ((channel='email' and recipient_reference=member_email)
      or (channel='push' and payload->>'push_user_id' not in(owner_id::text,other_id::text)))) then
    raise exception 'cancellation ignored occurrence exclusions or broadcast'; end if;
  if exists(select 1 from public.notification_deliveries where event_id=meeting_id and template_key='meeting_occurrence_cancelled'
    and ((payload->>'original_occurrence_start')::timestamptz<>cancel_at
      or payload->>'occurrence_id'<>appointment_id::text or payload->>'status'<>'cancelled'
      or payload ? 'description' or payload ? 'documents')) then raise exception 'incorrect cancellation action payload'; end if;
  if not exists(select 1 from public.notification_deliveries where reminder_id=fixture_reminder_id and status='skipped')
    or exists(select 1 from public.reminders where id=fixture_reminder_id and status='scheduled') then
    raise exception 'cancelled reminder can still notify'; end if;
  if (select count(*) from public.event_occurrences where event_id=meeting_id and status='scheduled')<>3 then
    raise exception 'cancellation changed other appointments'; end if;

  moved_id:=public.detach_meeting_occurrence(meeting_id,move_at,move_at+interval '1 day',
    'Moved agenda','Room 8',array[owner_email,member_email,external_email]);
  if public.detach_meeting_occurrence(meeting_id,move_at,move_at+interval '1 day','Moved agenda','Room 8',
    array[owner_email,member_email,external_email])<>moved_id then raise exception 'move replay created another Meeting'; end if;
  if (select count(*) from public.notification_deliveries where event_id=moved_id
    and template_key='meeting_occurrence_moved' and channel='email')<>3
    or (select count(*) from public.notification_deliveries where event_id=moved_id
      and template_key='meeting_occurrence_moved' and channel='push')<>2 then
    raise exception 'move must notify destination recipients once per channel'; end if;
  if exists(select 1 from public.notification_deliveries where event_id=moved_id
    and template_key in('meeting_created','meeting_guest_added','meeting_occurrence_cancelled')) then
    raise exception 'move produced creation/cancellation duplicate notices'; end if;
  if exists(select 1 from public.notification_deliveries where event_id=meeting_id and template_key='meeting_occurrence_cancelled'
    and (payload->>'original_occurrence_start')::timestamptz=move_at) then
    raise exception 'move sent an extra original cancellation notice'; end if;
  if exists(select 1 from public.notification_deliveries where event_id=moved_id and template_key='meeting_occurrence_moved'
    and ((payload->>'original_occurrence_start')::timestamptz<>move_at
      or (payload->>'new_occurrence_start')::timestamptz<>move_at+interval '1 day'
      or payload->>'original_event_id'<>meeting_id::text)) then raise exception 'move lost old/new dates'; end if;
  if not exists(select 1 from public.events where id=moved_id and recurrence_rule is null
    and end_datetime=start_datetime+interval '1 hour')
    or not exists(select 1 from public.reminders where event_id=moved_id and channel_email and channel_line
      and scheduled_at=move_at+interval '1 day') then raise exception 'move lost duration/reminders'; end if;
  perform public.refresh_meeting_occurrences(meeting_id);
  if (select count(*) from public.event_occurrences where event_id=meeting_id and status='scheduled')<>2 then
    raise exception 'cancelled or moved appointment reappeared'; end if;
  update public.events set email_notifications_enabled=false,mobile_notifications_enabled=false where id=meeting_id;
  perform public.cancel_meeting_occurrence(meeting_id,first_at);
  if exists(select 1 from public.notification_deliveries where event_id=meeting_id and template_key='meeting_occurrence_cancelled'
    and (payload->>'original_occurrence_start')::timestamptz=first_at) then raise exception 'channel opt-out ignored'; end if;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  begin
    perform public.cancel_meeting_occurrence(meeting_id,first_at+interval '10 days');
    raise exception 'non-owner cancellation accepted';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.cancel_meeting_occurrence_internal(uuid,timestamptz,boolean)','EXECUTE')
    or has_function_privilege('anon','public.cancel_meeting_occurrence_internal(uuid,timestamptz,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.queue_meeting_occurrence_action(uuid,uuid,timestamptz,timestamptz,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.cancel_meeting_occurrence(uuid,timestamptz)','EXECUTE') then
    raise exception 'private helper/public RPC authorization widened'; end if;
end;
$$;
select 'PASS: occurrence cancel/move notices; exact old/new dates; preferences/current recipients; retry deduplication; no duplicate creation notices; original recurrence and access retained' as result;
rollback;
