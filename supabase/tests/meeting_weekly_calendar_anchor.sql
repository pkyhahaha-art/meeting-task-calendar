-- Synthetic series, recipients, documents and deliveries all roll back.
begin;
do $$
declare creator_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); meeting_id uuid;
  first_date date:=date '2026-10-16'; first_at timestamptz; actual timestamptz[]; expected timestamptz[];
  target_occurrence uuid; target_reminder uuid; queued_delivery uuid; moved_id uuid; preserved_occurrence uuid;
  legacy_id uuid; sunday_id uuid; sunday_date date; sunday_at timestamptz;
begin
  if first_date<=(now() at time zone 'Asia/Bangkok')::date then
    first_date:=(now() at time zone 'Asia/Bangkok')::date;
    first_date:=first_date+((5-extract(isodow from first_date)::integer+7)%7)+7;
  end if;
  first_at:=(first_date+time '00:30') at time zone 'Asia/Bangkok';
  insert into auth.users(id,email,raw_user_meta_data) values
    (creator_id,'rollback-'||creator_id||'@gmail.com','{"full_name":"Week Anchor Creator"}'),
    (member_id,'rollback-'||member_id||'@gmail.com','{"full_name":"Week Anchor Member"}');
  update public.profiles set status='active' where id in(creator_id,member_id);
  perform set_config('request.jwt.claim.sub',creator_id::text,true);
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_until,
    suppress_guest_notifications,email_notifications_enabled,mobile_notifications_enabled)
    values(creator_id,'Calendar week anchor rollback',first_at,first_at+interval '1 hour',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,FR',first_at+interval '45 days',true,false,false) returning id into meeting_id;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(meeting_id,0,'minute',first_at,true,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences
    where event_id=meeting_id and status='scheduled';
  expected:=array[first_at,first_at+interval '12 days',first_at+interval '14 days',first_at+interval '26 days',
    first_at+interval '28 days',first_at+interval '40 days',first_at+interval '42 days'];
  if actual is distinct from expected then raise exception 'Fri start WE/FR shared two-week cycle mismatch: %',actual; end if;
  if (select count(*) from public.reminders where event_id=meeting_id)<>7 or exists(
    select 1 from public.event_occurrences where event_id=meeting_id and end_datetime-start_datetime<>interval '1 hour'
      or event_id=meeting_id and (start_datetime at time zone 'Asia/Bangkok')::time<>time '00:30') then
    raise exception 'Calendar anchor lost Bangkok time, duration or reminder deduplication'; end if;

  update public.events set recurrence_rule='FREQ=WEEKLY;INTERVAL=3;BYDAY=WE,FR',recurrence_until=null,recurrence_count=5 where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '19 days',first_at+interval '21 days',first_at+interval '40 days',first_at+interval '42 days'] then
    raise exception 'Three-week calendar cycle/count mismatch: %',actual; end if;
  update public.events set recurrence_rule='FREQ=WEEKLY;INTERVAL=4;BYDAY=WE,FR' where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '26 days',first_at+interval '28 days',first_at+interval '54 days',first_at+interval '56 days'] then
    raise exception 'Four-week calendar cycle/count mismatch: %',actual; end if;
  update public.events set recurrence_rule='FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,FR',recurrence_count=null,recurrence_until=first_at+interval '14 days' where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '12 days',first_at+interval '14 days'] then
    raise exception 'Until date must be inclusive in the shared cycle'; end if;
  update public.events set recurrence_count=1,recurrence_until=null where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  if (select array_agg(start_datetime order by start_datetime) from public.event_occurrences where event_id=meeting_id and status='scheduled')
    is distinct from array[first_at] then raise exception 'Start counted twice'; end if;

  -- Existing >4 intervals stay supported by the data contract.
  insert into public.events(owner_user_id,title,start_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    values(creator_id,'Legacy six-week rollback',first_at,'FREQ=WEEKLY;INTERVAL=6;BYDAY=WE,FR',5,true) returning id into legacy_id;
  perform public.refresh_meeting_occurrences(legacy_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=legacy_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '40 days',first_at+interval '42 days',first_at+interval '82 days',first_at+interval '84 days'] then
    raise exception 'Legacy interval >4 lost support'; end if;
  -- Sunday belongs to the preceding Monday's week, even across a year boundary.
  sunday_date:=date '2026-12-27';
  if sunday_date<=(now() at time zone 'Asia/Bangkok')::date
    or sunday_date+24>((now()+interval '12 months') at time zone 'Asia/Bangkok')::date then
    sunday_date:=(now() at time zone 'Asia/Bangkok')::date;
    sunday_date:=sunday_date+((7-extract(isodow from sunday_date)::integer+7)%7)+7;
  end if;
  sunday_at:=(sunday_date+time '00:30') at time zone 'Asia/Bangkok';
  insert into public.events(owner_user_id,title,start_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    values(creator_id,'Sunday year boundary rollback',sunday_at,'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',3,true) returning id into sunday_id;
  perform public.refresh_meeting_occurrences(sunday_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=sunday_id and status='scheduled';
  if actual is distinct from array[sunday_at,sunday_at+interval '10 days',sunday_at+interval '24 days'] then
    raise exception 'Sunday/year boundary anchor mismatch'; end if;

  -- A refresh preserves occurrence identity, notes, recipients and private files
  -- across temporary count changes; explicit cancellation and moves stay absent.
  update public.events set recurrence_count=7,recurrence_until=null where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select id into preserved_occurrence from public.event_occurrences where event_id=meeting_id and occurrence_key=first_at+interval '42 days';
  perform public.update_meeting_occurrence_details(meeting_id,first_at+interval '42 days','Preserve local agenda','Room 9',
    array['rollback-'||member_id||'@gmail.com']);
  insert into public.attachments(event_id,occurrence_id,scope,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(meeting_id,preserved_occurrence,'occurrence','Retained.pdf','application/pdf',1,'rollback/'||gen_random_uuid(),creator_id);
  select id into target_reminder from public.reminders where occurrence_id=preserved_occurrence;
  insert into public.notification_deliveries(event_id,reminder_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload) values(meeting_id,target_reminder,'owner',creator_id::text,'push',
      'rollback:'||gen_random_uuid(),first_at+interval '42 days','meeting_reminder','{}') returning id into queued_delivery;
  update public.events set recurrence_count=6 where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  if not exists(select 1 from public.event_occurrences where id=preserved_occurrence and status='cancelled'
    and override_payload->>'recurrence_removed'='true' and override_payload->>'description'='Preserve local agenda')
    or not exists(select 1 from public.notification_deliveries where id=queued_delivery and status='skipped') then
    raise exception 'Count reduction lost occurrence state or left a reminder queued'; end if;
  update public.events set recurrence_count=7 where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  if not exists(select 1 from public.event_occurrences where id=preserved_occurrence and status='scheduled'
    and override_payload->>'description'='Preserve local agenda')
    or not exists(select 1 from public.event_guests where occurrence_id=preserved_occurrence and revoked_at is null)
    or not exists(select 1 from public.attachments where occurrence_id=preserved_occurrence)
    or not exists(select 1 from public.notification_deliveries where id=queued_delivery and status='queued') then
    raise exception 'Count restoration lost notes/guests/documents/reminders'; end if;
  perform public.cancel_meeting_occurrence(meeting_id,first_at+interval '12 days');
  moved_id:=public.detach_meeting_occurrence(meeting_id,first_at+interval '14 days',first_at+interval '15 days','Moved notes','Room 8','{}');
  perform public.refresh_meeting_occurrences(meeting_id);
  if exists(select 1 from public.event_occurrences where event_id=meeting_id
    and occurrence_key in(first_at+interval '12 days',first_at+interval '14 days') and status='scheduled')
    or not exists(select 1 from public.events where id=moved_id and recurrence_rule is null) then
    raise exception 'Refresh restored explicitly cancelled or moved appointments'; end if;
  if has_function_privilege('anon','public.materialize_event_occurrences_for_event(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.materialize_event_occurrences_for_event(uuid)','EXECUTE') then
    raise exception 'Materializer privileges widened'; end if;
end;
$$;
select 'PASS: shared Monday calendar cycles for intervals 2/3/4 and legacy >4; Bangkok/count/until; cancellations/moves and retained occurrence data' as result;
rollback;
