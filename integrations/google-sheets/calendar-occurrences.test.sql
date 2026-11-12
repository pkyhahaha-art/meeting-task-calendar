begin;
do $test$
declare
  lo timestamptz := date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  hi timestamptz := ((lo at time zone 'Asia/Bangkok') + interval '1 month') at time zone 'Asia/Bangkok';
  fixture_owner text := 'gcal-sync-fixture@example.invalid';
  fixture_member_id uuid;
  fixture_member_email text;
  original uuid;
  payload jsonb;
  result jsonb;
  notifications_before bigint;
begin
  select id, email into fixture_member_id, fixture_member_email
  from public.profiles p
  where p.status = 'active' and nullif(btrim(p.email), '') is not null
    and not exists (select 1 from public.mobile_push_subscriptions device where device.user_id = p.id)
  order by p.id limit 1;
  if fixture_member_id is null then raise exception 'Missing active fixture member without a connected device'; end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('app.google_calendar_sync_notification_defaults', 'enabled', true);
  insert into public.events(owner_user_id, title, google_event_id, calendar_owner_email, start_datetime, affiliation)
  values (fixture_member_id, 'Direct authenticated insert', 'gcal-v2:fixture:authenticated-direct', fixture_member_email,
    hi + interval '2 days', '');
  if not exists (select from public.events where google_event_id='gcal-v2:fixture:authenticated-direct'
    and not email_notifications_enabled and not mobile_notifications_enabled)
  then raise exception 'Direct authenticated insert bypassed the import guard'; end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.events(owner_user_id, title, google_event_id, calendar_owner_email, start_datetime, affiliation)
  values (fixture_member_id, 'Null import id', null, fixture_member_email, hi + interval '4 days', '');
  insert into public.events(owner_user_id, title, google_event_id, calendar_owner_email, start_datetime, affiliation)
  values (fixture_member_id, 'Legacy import id', 'legacy-google-fixture-id', fixture_member_email, hi + interval '5 days', '');
  if exists (select from public.events where title in ('Null import id','Legacy import id')
    and (email_notifications_enabled or mobile_notifications_enabled))
  then raise exception 'Notification defaults applied to a non-v2 Google ID'; end if;

  perform set_config('app.google_calendar_sync_notification_defaults', 'enabled', true);
  insert into public.events(owner_user_id, title, google_event_id, calendar_owner_email, start_datetime, affiliation)
  values (fixture_member_id, 'Null import id with marker', null, fixture_member_email, hi + interval '6 days', '');
  insert into public.events(owner_user_id, title, google_event_id, calendar_owner_email, start_datetime, affiliation)
  values (fixture_member_id, 'Legacy import id with marker', 'legacy-google-fixture-with-marker', fixture_member_email,
    hi + interval '7 days', '');
  if exists (select from public.events where title in ('Null import id with marker','Legacy import id with marker')
    and (email_notifications_enabled or mobile_notifications_enabled))
  then raise exception 'Notification defaults applied to a null or non-v2 ID'; end if;

  perform set_config('app.google_calendar_sync_notification_defaults', '', true);
  perform public.sync_google_calendar_events(jsonb_build_array(jsonb_build_object(
    'google_event_id','gcal-v2:fixture:service-direct','calendar_owner_email',fixture_member_email,
    'title','Direct service import without wrapper','start_time',hi + interval '3 days')),
    null, null, null);
  if not exists (select from public.events where google_event_id='gcal-v2:fixture:service-direct'
    and not email_notifications_enabled and not mobile_notifications_enabled)
  then raise exception 'Direct service RPC bypassed the sync wrapper marker'; end if;

  insert into public.mobile_push_subscriptions(user_id, endpoint, p256dh, auth)
  values (fixture_member_id, 'https://updates.push.services.mozilla.com/wpush/v2/calendar-sync-fixture-' || gen_random_uuid()::text,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA');

  insert into public.events(owner_user_id, title, google_event_id, calendar_owner_email, start_datetime, affiliation)
  select id,'Same title','gcal-fixture-legacy',fixture_owner,lo+interval '1 day 7 hours','' from public.profiles where status='active' order by id limit 1
  returning id into original;
  if original is null then raise exception 'Missing synthetic fixture owner'; end if;
  payload := jsonb_build_array(
    jsonb_build_object('google_event_id','gcal-v2:fixture:one','legacy_google_event_id','gcal-fixture-legacy','calendar_owner_email',fixture_owner,'title','Same title','start_time',lo+interval '1 day'),
    jsonb_build_object('google_event_id','gcal-v2:fixture:two','legacy_google_event_id','gcal-fixture-legacy','calendar_owner_email',fixture_owner,'title','Same title','start_time',lo+interval '2 days'),
    jsonb_build_object('google_event_id','gcal-v2:fixture:distinct','legacy_google_event_id','gcal-fixture-other','calendar_owner_email',fixture_owner,'title','Same title','start_time',lo+interval '3 days'),
    jsonb_build_object('google_event_id','gcal-v2:fixture:member','calendar_owner_email',fixture_member_email,'title','Member appointment','start_time',lo+interval '15 days'));
  result := public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner,fixture_member_email],true);
  if (result->>'upserted')::int <> 4 or (result->>'adopted')::int <> 1
    or (select count(*) from public.events where calendar_owner_email=fixture_owner) <> 1
    or exists (select from public.events where google_event_id='gcal-v2:fixture:member')
  then raise exception 'Preview persisted changes or lost occurrences'; end if;
  perform public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner,fixture_member_email],false);
  if (select count(*) from public.events where calendar_owner_email=fixture_owner and deleted_at is null) <> 3
    or not exists (select from public.events where id=original and google_event_id='gcal-v2:fixture:one' and start_datetime=lo+interval '1 day')
  then raise exception 'Same-title sync or legacy adoption failed'; end if;
  if not exists (select from public.events where google_event_id='gcal-v2:fixture:member'
    and owner_user_id=fixture_member_id and email_notifications_enabled and mobile_notifications_enabled)
    or exists (select from public.notification_deliveries d join public.events e on e.id=d.event_id
      where e.google_event_id='gcal-v2:fixture:member')
    or exists (select from public.events where calendar_owner_email=fixture_owner
      and (email_notifications_enabled or mobile_notifications_enabled))
  then raise exception 'New member calendar appointment did not receive channel defaults cleanly'; end if;

  update public.events set email_notifications_enabled=false, mobile_notifications_enabled=false
  where google_event_id='gcal-v2:fixture:member';
  perform public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner,fixture_member_email],false);
  if not exists (select from public.events where google_event_id='gcal-v2:fixture:member'
    and not email_notifications_enabled and not mobile_notifications_enabled)
  then raise exception 'Calendar sync overwrote saved notification choices'; end if;

  delete from public.mobile_push_subscriptions
  where user_id=fixture_member_id and endpoint like 'https://updates.push.services.mozilla.com/wpush/v2/calendar-sync-fixture-%';
  payload := payload || jsonb_build_array(
    jsonb_build_object('google_event_id','gcal-v2:fixture:member-no-device','calendar_owner_email',fixture_member_email,
      'title','Member appointment without device','start_time',lo+interval '16 days'));
  perform public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner,fixture_member_email],false);
  if not exists (select from public.events where google_event_id='gcal-v2:fixture:member-no-device'
    and owner_user_id=fixture_member_id and email_notifications_enabled and not mobile_notifications_enabled)
  then raise exception 'Mobile default was enabled without a connected device'; end if;

  perform public.sync_google_calendar_occurrences(payload - 1,lo,hi,array[fixture_owner,fixture_member_email],false);
  if (select count(*) from public.events where calendar_owner_email=fixture_owner and deleted_at is null) <> 2
    or not exists (select from public.events where google_event_id='gcal-v2:fixture:two' and deleted_at is not null)
  then raise exception 'Deletion changed another appointment'; end if;
  perform public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner,fixture_member_email],false);
  if (select count(*) from public.events where calendar_owner_email=fixture_owner and deleted_at is null) <> 3 then raise exception 'Reimport failed'; end if;
  update public.events set status='cancelled' where id=original;
  select count(*) into notifications_before from public.notification_deliveries where event_id=original;
  result := public.sync_google_calendar_occurrences(payload,lo,hi,array[fixture_owner,fixture_member_email],false);
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
    ),lo,hi,array[fixture_owner,fixture_member_email],false);
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
