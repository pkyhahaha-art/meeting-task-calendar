-- Synthetic fixtures only; always rolled back and never send notifications.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); fixture_event_id uuid; first_id uuid; next_id uuid;
  first_at timestamptz:=now()+interval '5 days'; fixture_email text:='scope-fixture@example.invalid';
begin
  if has_function_privilege('authenticated','public.record_occurrence_acknowledgement(uuid,uuid,text)','execute')
    or has_table_privilege('authenticated','public.event_occurrence_acknowledgements','insert')
    or has_table_privilege('anon','public.event_occurrence_acknowledgements','select') then
    raise exception 'occurrence acknowledgement privileges expanded';
  end if;
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
    values(owner_id,'ack-owner-'||owner_id::text||'@gmail.com',now(),'{}'::jsonb);
  update public.profiles set status='active',email_verified_at=now() where id=owner_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.events(owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    values(owner_id,'ack fixture',first_at,first_at+interval '1 hour','FREQ=DAILY;INTERVAL=1',2,true) returning id into fixture_event_id;
  perform public.refresh_meeting_occurrences(fixture_event_id);
  select id into first_id from public.event_occurrences o where o.event_id=fixture_event_id and o.start_datetime=first_at;
  select id into next_id from public.event_occurrences o where o.event_id=fixture_event_id and o.start_datetime=first_at+interval '1 day';
  insert into public.event_guests(event_id,email,self_join_from) values(fixture_event_id,fixture_email,first_at);
  insert into public.email_acknowledgement_tokens(event_id,occurrence_id,recipient_type,recipient_reference,token_hash,expires_at)
    values(fixture_event_id,first_id,'guest',fixture_email,'fixture-scoped-'||owner_id,now()+interval '1 day');
  if public.consume_email_acknowledgement('fixture-scoped-'||owner_id)<>'acknowledged'
    or public.consume_email_acknowledgement('fixture-scoped-'||owner_id)<>'acknowledged' then raise exception 'scoped acknowledgment failed'; end if;
  if (select count(*) from public.event_occurrence_acknowledgements a where a.event_id=fixture_event_id and a.occurrence_id=first_id and a.email=fixture_email)<>1
    or exists(select 1 from public.event_occurrence_acknowledgements a where a.event_id=fixture_event_id and a.occurrence_id=next_id)
    or exists(select 1 from public.event_guests g where g.event_id=fixture_event_id and g.acknowledged_at is not null) then
    raise exception 'scoped acknowledgment leaked across occurrences'; end if;
  insert into public.email_acknowledgement_tokens(event_id,recipient_type,recipient_reference,token_hash,expires_at)
    values(fixture_event_id,'guest',fixture_email,'fixture-unscoped-'||owner_id,now()+interval '1 day');
  if public.consume_email_acknowledgement('fixture-unscoped-'||owner_id)<>'recipient_not_found' then raise exception 'changed-scope unscoped token allowed'; end if;
  insert into public.event_occurrence_guest_exclusions(occurrence_id,email) values(next_id,fixture_email);
  insert into public.email_acknowledgement_tokens(event_id,occurrence_id,recipient_type,recipient_reference,token_hash,expires_at)
    values(fixture_event_id,next_id,'guest',fixture_email,'fixture-excluded-'||owner_id,now()+interval '1 day');
  if public.consume_email_acknowledgement('fixture-excluded-'||owner_id)<>'recipient_not_found' then raise exception 'excluded guest was acknowledged'; end if;
  insert into public.event_guests(event_id,email,acknowledged_at)
    values(fixture_event_id,'legacy-ack@example.invalid',now()-interval '1 day');
  update public.event_guests set self_join_from=first_at,self_join_until=first_at
    where event_id=fixture_event_id and email='legacy-ack@example.invalid';
  if not exists(select 1 from public.event_occurrence_acknowledgements a where a.occurrence_id=first_id and a.email='legacy-ack@example.invalid')
    or exists(select 1 from public.event_occurrence_acknowledgements a where a.occurrence_id=next_id and a.email='legacy-ack@example.invalid') then
    raise exception 'legacy acknowledgement not preserved only for retained appointment'; end if;
  update public.event_guests set attendance_history=jsonb_build_array(jsonb_build_object('from',self_join_from,'until',self_join_until)),
    self_join_from=first_at+interval '1 day',self_join_until=null
    where event_id=fixture_event_id and email='legacy-ack@example.invalid';
  if exists(select 1 from public.event_occurrence_acknowledgements a where a.occurrence_id=next_id and a.email='legacy-ack@example.invalid') then
    raise exception 'legacy acknowledgement resurrected on rejoin'; end if;
end;
$$;
rollback;
