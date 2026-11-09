-- Synthetic fixtures only. Wrap in a rolled-back transaction; never send notifications.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  meeting_id uuid:=gen_random_uuid(); legacy_id uuid:=gen_random_uuid(); moved_id uuid; direct_id uuid:=gen_random_uuid();
  first_at timestamptz:=date_trunc('second',now()+interval '3 days'); payload jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (owner_id,'grc-owner-'||owner_id||'@gmail.com','{"full_name":"GRC owner"}'),
    (admin_id,'grc-admin-'||admin_id||'@gmail.com','{"full_name":"GRC admin"}'),
    (other_id,'grc-other-'||other_id||'@gmail.com','{"full_name":"GRC other"}');
  update public.profiles set status='active' where id in(owner_id,admin_id,other_id);
  update public.profiles set role='admin' where id=admin_id;
  payload:=jsonb_build_object('title','GRC fixture','description','','location','','affiliation','',
    'all_day',false,'start_datetime',first_at,'end_datetime',first_at+interval '1 hour',
    'recurrence_rule','FREQ=DAILY','recurrence_until',null,'recurrence_count',3,
    'email_notifications_enabled',false,'mobile_notifications_enabled',false,
    'grc_category_key','S001','committee_key','C007');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  -- New API saves require both keys; do not allow stale clients to insert nulls.
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(gen_random_uuid(),payload-'grc_category_key','{}','[]'::jsonb,true);
    reset role;
    raise exception 'missing GRC accepted for new meeting';
  exception when invalid_parameter_value then reset role; end;
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(gen_random_uuid(),payload||'{"committee_key":null}'::jsonb,'{}','[]'::jsonb,true);
    reset role;
    raise exception 'missing committee accepted for new meeting';
  exception when invalid_parameter_value then reset role; end;
  begin
    set local role authenticated;
    insert into public.events(owner_user_id,title,start_datetime) values(owner_id,'Direct missing categories',first_at);
    reset role;
    raise exception 'direct insert bypassed required categories';
  exception when invalid_parameter_value then reset role; end;
  set local role authenticated;
  insert into public.events(id,owner_user_id,title,start_datetime,grc_category_key,committee_key)
    values(direct_id,owner_id,'Direct valid categories',first_at,'S099','C099');
  reset role;
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload,'{}','[]'::jsonb,true);
  reset role;
  if not exists(select 1 from public.events where id=meeting_id and grc_category_key='S001' and committee_key='C007') then raise exception 'key creation failed'; end if;
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload,'{}','[]'::jsonb,true);
  reset role;
  if (select count(*) from public.events where id=meeting_id)<>1 then raise exception 'replay duplicated meeting'; end if;
  -- Older clients omit keys: they must preserve both values.
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload-array['grc_category_key','committee_key'],'{}','[]'::jsonb,false);
  reset role;
  if not exists(select 1 from public.events where id=meeting_id and grc_category_key='S001' and committee_key='C007') then raise exception 'old client cleared keys'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload||'{"grc_category_key":"S005","committee_key":"C099"}'::jsonb,'{}','[]'::jsonb,false);
  reset role;
  if not exists(select 1 from public.events where id=meeting_id and grc_category_key='S005' and committee_key='C099') then raise exception 'admin edit failed'; end if;
  -- Explicit NULL clears a choice; a later save restores it for move coverage.
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload||'{"grc_category_key":null,"committee_key":null}'::jsonb,'{}','[]'::jsonb,false);
  reset role;
  if not exists(select 1 from public.events where id=meeting_id and grc_category_key is null and committee_key is null) then raise exception 'explicit null did not clear keys'; end if;
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload||'{"grc_category_key":"S005","committee_key":"C099"}'::jsonb,'{}','[]'::jsonb,false);
  reset role;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(meeting_id,payload,'{}','[]'::jsonb,false);
    reset role;
    raise exception 'unrelated user edited meeting';
  exception when insufficient_privilege then reset role; end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(meeting_id,payload||'{"grc_category_key":"S999"}'::jsonb,'{}','[]'::jsonb,false);
    reset role;
    raise exception 'invalid key accepted';
  exception when check_violation then reset role; end;
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(meeting_id,payload||'{"committee_key":"C999"}'::jsonb,'{}','[]'::jsonb,false);
    reset role;
    raise exception 'invalid committee key accepted';
  exception when check_violation then reset role; end;
  set local role authenticated;
  moved_id:=public.detach_meeting_occurrence(meeting_id,first_at+interval '1 day',first_at+interval '5 days','','','{}');
  reset role;
  if not exists(select 1 from public.events where id=moved_id and grc_category_key='S005' and committee_key='C099' and recurrence_rule is null) then raise exception 'detached meeting lost keys'; end if;
  -- Existing records may predate the new fields. Editing and detaching an old
  -- occurrence must preserve NULL instead of demanding retroactive selection.
  insert into public.events(id,owner_user_id,title,start_datetime,end_datetime,recurrence_rule,recurrence_count)
    values(legacy_id,owner_id,'Legacy',first_at,first_at+interval '1 hour','FREQ=DAILY',3);
  perform public.refresh_meeting_occurrences(legacy_id);
  set local role authenticated;
  perform public.save_meeting_event_v3(legacy_id,(payload-array['grc_category_key','committee_key'])||'{"title":"Legacy edited"}'::jsonb,'{}','[]'::jsonb,false);
  moved_id:=public.detach_meeting_occurrence(legacy_id,first_at+interval '1 day',first_at+interval '8 days','','','{}');
  reset role;
  if not exists(select 1 from public.events where id=legacy_id and grc_category_key is null and committee_key is null)
    or not exists(select 1 from public.events where id=moved_id and grc_category_key is null and committee_key is null) then
    raise exception 'legacy edit or detach changed null category values'; end if;
end $$;
select 'PASS: GRC keys, replay, legacy clients, admin permissions and detached occurrences' as result;
rollback;
