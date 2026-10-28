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
  if not public.join_meeting_as_attendee(meeting_id,next_at,'series') then
    raise exception 'series expansion must succeed'; end if;
  if public.join_meeting_as_attendee(meeting_id,next_at,'series') then
    raise exception 'repeat series join must be idempotent'; end if;
  if (select count(*) from public.event_guests where event_id=meeting_id and occurrence_id is null)<>1 then
    raise exception 'series guest row missing or duplicated'; end if;
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
