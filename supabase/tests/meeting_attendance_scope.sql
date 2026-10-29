-- Synthetic fixture; executes in a rolled-back transaction and sends no notifications.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  member_email text:='scope-'||member_id::text||'@gmail.com'; other_email text:='scope-'||other_id::text||'@gmail.com';
  meeting_id uuid; first_at timestamptz:=now()+interval '10 days'; selected_at timestamptz:=now()+interval '11 days';
  gap_at timestamptz:=now()+interval '12 days'; again_at timestamptz:=now()+interval '13 days';
  first_id uuid; selected_id uuid; gap_id uuid; again_id uuid; inserted_id uuid; guest_id uuid; past_id uuid;
begin
  if not has_function_privilege('authenticated','public.change_meeting_attendance_to_occurrence(uuid,timestamptz)','execute')
    or has_function_privilege('anon','public.change_meeting_attendance_to_occurrence(uuid,timestamptz)','execute') then
    raise exception 'attendance scope RPC privileges invalid'; end if;
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (owner_id,'scope-'||owner_id::text||'@gmail.com',now(),'{}'::jsonb), (member_id,member_email,now(),'{}'::jsonb), (other_id,other_email,now(),'{}'::jsonb);
  update public.profiles set status='active',email_verified_at=now() where id in(owner_id,member_id,other_id);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    values(owner_id,'Scope rollback fixture',first_at,first_at+interval '1 hour','FREQ=DAILY;INTERVAL=1',4,true) returning id into meeting_id;
  perform public.refresh_meeting_occurrences(meeting_id);
  select id into first_id from public.event_occurrences where event_id=meeting_id and start_datetime=first_at;
  select id into selected_id from public.event_occurrences where event_id=meeting_id and start_datetime=selected_at;
  select id into gap_id from public.event_occurrences where event_id=meeting_id and start_datetime=gap_at;
  select id into again_id from public.event_occurrences where event_id=meeting_id and start_datetime=again_at;
  insert into public.event_occurrences(event_id,occurrence_key,start_datetime,status)
    values(meeting_id,now()-interval '1 day',now()-interval '1 day','scheduled') returning id into past_id;
  insert into public.event_guests(event_id,email) values(meeting_id,member_email) returning id into guest_id;
  insert into public.event_guests(event_id,email) values(meeting_id,other_email);
  insert into public.email_acknowledgement_tokens(event_id,recipient_type,recipient_reference,token_hash,expires_at)
    values(meeting_id,'guest',member_email,encode(gen_random_bytes(32),'hex'),now()+interval '1 day'),
          (meeting_id,'guest',other_email,encode(gen_random_bytes(32),'hex'),now()+interval '1 day');
  insert into public.event_guests(event_id,occurrence_id,email) values(meeting_id,gap_id,member_email);
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  if not public.change_meeting_attendance_to_occurrence(meeting_id,selected_at) then raise exception 'scope change not performed'; end if;
  if public.change_meeting_attendance_to_occurrence(meeting_id,selected_at) then raise exception 'scope retry not idempotent'; end if;
  if exists(select 1 from public.email_acknowledgement_tokens where event_id=meeting_id and recipient_reference=member_email)
    or not exists(select 1 from public.email_acknowledgement_tokens where event_id=meeting_id and recipient_reference=other_email) then
    raise exception 'legacy acknowledgement token invalidation affected the wrong guest'; end if;
  if not exists(select 1 from public.event_guests where id=guest_id and self_join_until=selected_at) then raise exception 'base guest identity lost'; end if;
  if exists(select 1 from public.event_guests where event_id=meeting_id and occurrence_id=gap_id and email=member_email and revoked_at is null) then
    raise exception 'future occurrence-only membership still exists after selecting a single occurrence'; end if;
  if not exists(select 1 from public.occurrence_guest_emails(meeting_id,past_id) where email=member_email)
    or exists(select 1 from public.occurrence_guest_emails(meeting_id,first_id) where email=member_email)
    or not exists(select 1 from public.occurrence_guest_emails(meeting_id,selected_id) where email=member_email)
    or exists(select 1 from public.occurrence_guest_emails(meeting_id,gap_id) where email=member_email)
    or not exists(select 1 from public.occurrence_guest_emails(meeting_id,gap_id) where email=other_email) then
    raise exception 'scope change affected wrong occurrences or other member'; end if;
  update public.event_occurrences set start_datetime=selected_at+interval '30 minutes' where id=selected_id;
  if not exists(select 1 from public.occurrence_guest_emails(meeting_id,selected_id) where email=member_email) then
    raise exception 'selected occurrence lost attendance when rescheduled'; end if;
  update public.event_occurrences set start_datetime=selected_at where id=selected_id;
  if not public.join_meeting_as_attendee(meeting_id,again_at,'series') then raise exception 'scope upgrade failed'; end if;
  if public.join_meeting_as_attendee(meeting_id,again_at,'series') then raise exception 'scope upgrade retry not idempotent'; end if;
  if not exists(select 1 from public.occurrence_guest_emails(meeting_id,past_id) where email=member_email)
    or exists(select 1 from public.occurrence_guest_emails(meeting_id,first_id) where email=member_email)
    or not exists(select 1 from public.occurrence_guest_emails(meeting_id,selected_id) where email=member_email)
    or exists(select 1 from public.occurrence_guest_emails(meeting_id,gap_id) where email=member_email)
    or not exists(select 1 from public.occurrence_guest_emails(meeting_id,again_id) where email=member_email) then
    raise exception 'scope roundtrip restored a gap or lost history'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.refresh_meeting_occurrences(meeting_id);
  insert into public.event_occurrences(event_id,occurrence_key,start_datetime,status)
    values(meeting_id,gap_at+interval '1 hour',gap_at+interval '1 hour','scheduled') returning id into inserted_id;
  if exists(select 1 from public.occurrence_guest_emails(meeting_id,inserted_id) where email=member_email) then
    raise exception 'newly materialized gap restored membership'; end if;
  perform public.update_meeting_occurrence_details(meeting_id,gap_at,'','',array[member_email,other_email]);
  if not exists(select 1 from public.occurrence_guest_emails(meeting_id,gap_id) where email=member_email) then
    raise exception 'owner cannot explicitly re-invite in gap'; end if;
end;
$$;
rollback;
