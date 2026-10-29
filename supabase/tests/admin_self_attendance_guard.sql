-- Synthetic users and events only; transaction is rolled back, with no delivery.
begin;
do $$
declare
  creator uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid();
  admin_email text:='admin-scope-'||admin_id||'@gmail.com'; member_email text:='member-scope-'||member_id||'@gmail.com';
  meeting uuid; another_meeting uuid; admin_guest uuid; member_guest uuid; extra_guest uuid;
  start_at timestamptz:=date_trunc('second',now()+interval '10 days'); selected_at timestamptz:=start_at+interval '1 day';
  later_at timestamptz:=start_at+interval '2 days'; selected_id uuid; later_id uuid; n integer;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (creator,'creator-scope-'||creator||'@gmail.com',now(),'{}'),
    (admin_id,admin_email,now(),'{}'), (member_id,member_email,now(),'{}');
  update public.profiles set status='active',email_verified_at=now() where id in (creator,admin_id,member_id);
  update public.profiles set role='admin' where id=admin_id;
  perform set_config('request.jwt.claim.sub',creator::text,true);
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    values(creator,'Admin self attendance fixture',start_at,start_at+interval '1 hour','FREQ=DAILY;INTERVAL=1',3,true) returning id into meeting;
  insert into public.events(owner_user_id,title,start_datetime,suppress_guest_notifications)
    values(creator,'Other fixture',start_at,true) returning id into another_meeting;
  perform public.refresh_meeting_occurrences(meeting);
  select id into selected_id from public.event_occurrences where event_id=meeting and start_datetime=selected_at;
  select id into later_id from public.event_occurrences where event_id=meeting and start_datetime=later_at;
  insert into public.event_guests(event_id,email) values(meeting,admin_email) returning id into admin_guest;
  insert into public.event_guests(event_id,email) values(meeting,member_email) returning id into member_guest;
  insert into public.event_guests(event_id,email) values(meeting,'other-guard-fixture@gmail.com') returning id into extra_guest;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  update public.event_guests set email='renamed-guard-fixture@gmail.com' where id=extra_guest;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Ordinary admin guest edit stopped working'; end if;
  -- Direct edits must not bypass the validated RPC even for the Admin's own row.
  begin
    update public.event_guests set self_join_from=selected_at where id=admin_guest;
    get diagnostics n=row_count;
    if n>0 then raise exception 'Direct scope edit permitted'; end if;
  exception when insufficient_privilege then null; end;
  begin
    update public.event_guests set self_join_until=selected_at where id=member_guest;
    get diagnostics n=row_count;
    if n>0 then raise exception 'Other guest scope edit permitted'; end if;
  exception when insufficient_privilege then null; end;
  begin
    update public.event_guests set event_id=another_meeting where id=member_guest;
    get diagnostics n=row_count;
    if n>0 then raise exception 'Guest reparent permitted'; end if;
  exception when insufficient_privilege then null; end;
  begin
    update public.event_guests set email='other-fixture@gmail.com',self_join_until=selected_at where id=admin_guest;
    get diagnostics n=row_count;
    if n>0 then raise exception 'Scope edit changed guest identity'; end if;
  exception when insufficient_privilege then null; end;
  begin
    update public.event_guests set occurrence_id=selected_id,self_join_until=selected_at where id=admin_guest;
    get diagnostics n=row_count;
    if n>0 then raise exception 'Scope edit moved occurrence'; end if;
  exception when insufficient_privilege then null; end;
  if not public.change_meeting_attendance_to_occurrence(meeting,selected_at) then raise exception 'Admin scope downgrade failed'; end if;
  if public.change_meeting_attendance_to_occurrence(meeting,selected_at) then raise exception 'Admin downgrade not idempotent'; end if;
  execute 'reset role';
  if not exists(select 1 from public.occurrence_guest_emails(meeting,selected_id) where email=admin_email)
    or exists(select 1 from public.occurrence_guest_emails(meeting,later_id) where email=admin_email)
    or not exists(select 1 from public.occurrence_guest_emails(meeting,later_id) where email=member_email) then
    raise exception 'Downgrade attendance scope wrong'; end if;
  -- The self scope exception never overrides organizer exclusions.
  perform set_config('request.jwt.claim.sub',creator::text,true);
  insert into public.event_occurrence_guest_exclusions(occurrence_id,email) values(later_id,admin_email);
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  begin perform public.join_meeting_as_attendee(meeting,later_at,'series');
    raise exception 'Admin rejoined an excluded appointment'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',creator::text,true);
  delete from public.event_occurrence_guest_exclusions where occurrence_id=later_id and email=admin_email;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  if not public.join_meeting_as_attendee(meeting,later_at,'series') then raise exception 'Admin scope upgrade failed'; end if;
  if public.join_meeting_as_attendee(meeting,later_at,'series') then raise exception 'Admin upgrade not idempotent'; end if;
  execute 'reset role';
  if not exists(select 1 from public.occurrence_guest_emails(meeting,later_id) where email=admin_email) then raise exception 'Admin series upgrade did not persist'; end if;
  update public.profiles set status='disabled' where id=admin_id;
  execute 'set local role authenticated';
  begin perform public.change_meeting_attendance_to_occurrence(meeting,selected_at);
    raise exception 'Disabled admin changed attendance'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  update public.profiles set status='active' where id=admin_id;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  execute 'set local role authenticated';
  if not public.change_meeting_attendance_to_occurrence(meeting,selected_at) then raise exception 'Member scope downgrade failed'; end if;
  if not public.join_meeting_as_attendee(meeting,later_at,'series') then raise exception 'Member scope upgrade failed'; end if;
  execute 'reset role';
end;
$$;
rollback;
