begin;
do $test$
declare
  lo timestamptz := date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  hi timestamptz := ((lo at time zone 'Asia/Bangkok') + interval '1 month') at time zone 'Asia/Bangkok';
  fixture_owner text := 'gcal-sync-fixture@example.invalid';
  original uuid;
  payload jsonb;
  result jsonb;
  notifications_before bigint;
begin
  insert into public.events(owner_user_id, title, google_event_id, calendar_owner_email, start_datetime, affiliation)
  select id,'Same title','gcal-fixture-legacy',fixture_owner,lo+interval '1 day 7 hours','' from public.profiles where status='active' order by id limit 1
  returning id into original;
  if original is null then raise exception 'Missing synthetic fixture owner'; end if;
  payload := jsonb_build_array(
    jsonb_build_object('google_event_id','gcal-v2:fixture:one','legacy_google_event_id','gcal-fixture-legacy','calendar_owner_email',fixture_owner,'title','Same title','start_time',lo+interval '1 day'),
    jsonb_build_object('google_event_id','gcal-v2:fixture:two','legacy_google_event_id','gcal-fixture-legacy','calendar_owner_email',fixture_owner,'title','Same title','start_time',lo+interval '2 days'),
    jsonb_build_object('google_event_id','gcal-v2:fixture:distinct','legacy_google_event_id','gcal-fixture-other','calendar_owner_email',fixture_owner,'title','Same title','start_time',lo+interval '3 days'));
  result := public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner],true);
  if (result->>'upserted')::int <> 3 or (result->>'adopted')::int <> 1
    or (select count(*) from public.events where calendar_owner_email=fixture_owner) <> 1 then raise exception 'Preview persisted changes or lost occurrences'; end if;
  perform public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner],false);
  if (select count(*) from public.events where calendar_owner_email=fixture_owner and deleted_at is null) <> 3
    or not exists (select from public.events where id=original and google_event_id='gcal-v2:fixture:one' and start_datetime=lo+interval '1 day')
  then raise exception 'Same-title sync or legacy adoption failed'; end if;
  perform public.sync_google_calendar_occurrences(payload - 1,lo,hi,array[fixture_owner],false);
  if (select count(*) from public.events where calendar_owner_email=fixture_owner and deleted_at is null) <> 2
    or not exists (select from public.events where google_event_id='gcal-v2:fixture:two' and deleted_at is not null)
  then raise exception 'Deletion changed another appointment'; end if;
  perform public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner],false);
  if (select count(*) from public.events where calendar_owner_email=fixture_owner and deleted_at is null) <> 3 then raise exception 'Reimport failed'; end if;
  update public.events set status='cancelled' where id=original;
  select count(*) into notifications_before from public.notification_deliveries where event_id=original;
  result := public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner],false);
  if (result->>'kept_cancelled')::int <> 1
    or not exists (select from public.events where id=original and status='cancelled')
    or (select count(*) from public.notification_deliveries where event_id=original) <> notifications_before
  then raise exception 'Calendar sync changed local cancellation or enqueued a notification'; end if;

  insert into public.events(owner_user_id,title,google_event_id,calendar_owner_email,start_datetime,affiliation)
  select id,'Unmatched appointment','gcal-fixture-unmatched',fixture_owner,lo+interval '5 days',''
    from public.profiles where status='active' order by id limit 1;
  begin
    perform public.sync_google_calendar_occurrences(payload || jsonb_build_array(
      jsonb_build_object('google_event_id','gcal-v2:fixture:unmatched','legacy_google_event_id','gcal-fixture-unmatched',
        'calendar_owner_email',fixture_owner,'title','Unmatched appointment','start_time',lo+interval '6 days')
    ),lo,hi,array[fixture_owner],false);
    raise exception 'An ambiguous legacy change did not fail closed';
  exception when sqlstate 'ZC002' then
    if not exists (select from public.events where google_event_id='gcal-fixture-unmatched' and deleted_at is null)
      or exists (select from public.events where google_event_id='gcal-v2:fixture:unmatched')
    then raise exception 'Unmatched legacy rejection changed data'; end if;
  end;

  if has_function_privilege('anon','public.sync_google_calendar_occurrences(jsonb,timestamptz,timestamptz,text[],boolean)','execute')
    or has_function_privilege('authenticated','public.sync_google_calendar_occurrences(jsonb,timestamptz,timestamptz,text[],boolean)','execute')
  then raise exception 'Unexpected client permission'; end if;
end;
$test$;
select 'PASS: preview, legacy ID, same-title rows, occurrence deletion, retry, cancellation, no notifications, unmatched legacy, grants' as result;

rollback;
