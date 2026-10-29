-- Run setup against migration 001, then apply migration 002, then assertions,
-- all within one transaction that is rolled back (see MIGRATION_BOUNDARY).
do $$
declare owner_id uuid:=gen_random_uuid(); fixture_event uuid; first_at timestamptz:=now()+interval '5 days'; excluded_id uuid;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
    values(owner_id,'ack-backfill-'||owner_id::text||'@gmail.com',now(),'{}'::jsonb);
  update public.profiles set status='active',email_verified_at=now() where id=owner_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    values(owner_id,'ack backfill fixture',first_at,first_at+interval '1 hour','FREQ=DAILY;INTERVAL=1',4,true) returning id into fixture_event;
  perform public.refresh_meeting_occurrences(fixture_event);
  insert into public.event_guests(event_id,email,self_join_from,acknowledged_at)
    values(fixture_event,'existing-ack@example.invalid',first_at+interval '1 day',now());
  select id into excluded_id from public.event_occurrences where event_id=fixture_event and start_datetime=first_at+interval '3 days';
  insert into public.event_occurrence_guest_exclusions(occurrence_id,email) values(excluded_id,'existing-ack@example.invalid');
  perform set_config('test.ack_fixture_event',fixture_event::text,true);
end;
$$;
-- MIGRATION_BOUNDARY
do $$
declare fixture_event uuid:=current_setting('test.ack_fixture_event')::uuid; first_at timestamptz; middle_id uuid; excluded_id uuid; later_id uuid;
begin
  select start_datetime into first_at from public.events where id=fixture_event;
  select id into middle_id from public.event_occurrences where event_id=fixture_event and start_datetime=first_at+interval '1 day';
  select id into later_id from public.event_occurrences where event_id=fixture_event and start_datetime=first_at+interval '2 days';
  select id into excluded_id from public.event_occurrences where event_id=fixture_event and start_datetime=first_at+interval '3 days';
  if (select count(*) from public.event_occurrence_acknowledgements where event_id=fixture_event)<>2
    or not exists(select 1 from public.event_occurrence_acknowledgements where occurrence_id=middle_id and email='existing-ack@example.invalid') then
    raise exception 'backfill lost existing acknowledgement or included ineligible appointment'; end if;
  update public.event_guests set self_join_from=first_at+interval '1 day',self_join_until=first_at+interval '1 day'
    where event_id=fixture_event and email='existing-ack@example.invalid';
  update public.event_guests set self_join_from=first_at+interval '2 days',self_join_until=null
    where event_id=fixture_event and email='existing-ack@example.invalid';
  if exists(select 1 from public.event_occurrence_acknowledgements where occurrence_id in (later_id,excluded_id) and email='existing-ack@example.invalid') then
    raise exception 'backfill or scope transition restored ineligible acknowledgment'; end if;
end;
$$;
