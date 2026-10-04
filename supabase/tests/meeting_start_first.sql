-- Fixtures and delivery queues roll back; no Email or Push is sent.
begin;
do $$
declare
  creator public.profiles;
  meeting_id uuid;
  first_date date;
  first_at timestamptz;
  actual timestamptz[];
  last_occurrence uuid;
  last_reminder uuid;
  queued_delivery uuid;
begin
  select * into creator from public.profiles where status='active' order by created_at limit 1;
  if creator.id is null then raise exception 'test requires an active profile'; end if;
  perform set_config('request.jwt.claim.sub',creator.id::text,true);
  first_date := (now() at time zone 'Asia/Bangkok')::date;
  first_date := first_date+((6-extract(isodow from first_date)::integer+7)%7)+7;
  first_at := (first_date+time '00:30') at time zone 'Asia/Bangkok';
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    values(creator.id,'Start-first rollback test',first_at,first_at+interval '1 hour','FREQ=WEEKLY;BYDAY=TU,WE',4,true)
    returning id into meeting_id;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(meeting_id,0,'minute',first_at,true,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences
    where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '3 days',first_at+interval '4 days',first_at+interval '10 days']
    then raise exception 'start-first dates differ: %',actual; end if;
  if (select count(*) from public.reminders where event_id=meeting_id)<>4
    then raise exception 'first reminder duplicated or upcoming reminders missing'; end if;
  if exists(select 1 from public.event_occurrences where event_id=meeting_id and end_datetime-start_datetime<>interval '1 hour')
    then raise exception 'duration changed'; end if;
  update public.reminders set status='completed' where event_id=meeting_id and occurrence_id is null;
  select id into last_occurrence from public.event_occurrences where event_id=meeting_id and start_datetime=first_at+interval '10 days';
  select id into last_reminder from public.reminders where occurrence_id=last_occurrence;
  update public.event_occurrences set override_payload='{"description":"Retain these notes"}' where id=last_occurrence;
  insert into public.attachments(event_id,occurrence_id,scope,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(meeting_id,last_occurrence,'occurrence','rollback.pdf','application/pdf',1,'rollback/'||gen_random_uuid(),creator.id);
  insert into public.notification_deliveries(event_id,reminder_id,recipient_type,recipient_reference,channel,idempotency_key,scheduled_at,template_key,payload)
    values(meeting_id,last_reminder,'owner',creator.id::text,'push','rollback:'||gen_random_uuid(),first_at+interval '10 days','meeting_reminder','{}')
    returning id into queued_delivery;
  update public.events set recurrence_count=3 where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  if not exists(select 1 from public.event_occurrences where id=last_occurrence and status='cancelled' and override_payload->>'description'='Retain these notes')
    or not exists(select 1 from public.attachments where occurrence_id=last_occurrence)
    then raise exception 'excluded appointment data was destroyed'; end if;
  if not exists(select 1 from public.reminders where id=last_reminder and status='cancelled')
    or not exists(select 1 from public.notification_deliveries where id=queued_delivery and status='skipped')
    then raise exception 'excluded appointment could still notify'; end if;
  update public.events set recurrence_count=4 where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  if not exists(select 1 from public.event_occurrences where id=last_occurrence and status='scheduled' and override_payload->>'description'='Retain these notes')
    or not exists(select 1 from public.reminders where id=last_reminder and status='scheduled')
    or not exists(select 1 from public.notification_deliveries where id=queued_delivery and status='queued')
    then raise exception 'increasing the count did not restore the appointment'; end if;
  if not exists(select 1 from public.reminders where event_id=meeting_id and occurrence_id is null and status='completed')
    then raise exception 'first reminder would be resent'; end if;
  update public.events set recurrence_rule='FREQ=WEEKLY;BYDAY=TU,FR,SA',recurrence_count=6 where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '3 days',first_at+interval '6 days',first_at+interval '7 days',first_at+interval '10 days',first_at+interval '13 days']
    then raise exception 'matching first date was counted twice'; end if;
  update public.events set recurrence_rule='FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,WE',recurrence_count=5 where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '10 days',first_at+interval '11 days',first_at+interval '24 days',first_at+interval '25 days']
    then raise exception 'biweekly anchor or Bangkok date changed'; end if;
  update public.events set recurrence_rule='FREQ=WEEKLY;BYDAY=TU,WE',recurrence_count=null,recurrence_until=first_at+interval '4 days' where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at,first_at+interval '3 days',first_at+interval '4 days'] then raise exception 'until date not respected'; end if;
  update public.events set recurrence_count=1,recurrence_until=null where id=meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select array_agg(start_datetime order by start_datetime) into actual from public.event_occurrences where event_id=meeting_id and status='scheduled';
  if actual is distinct from array[first_at] then raise exception 'count one did not mean the start alone'; end if;
end;
$$;
select 'PASS: start counts first; count/interval/until agree; reminders deduplicate; removed appointments retain their data and can be restored' as result;
rollback;
