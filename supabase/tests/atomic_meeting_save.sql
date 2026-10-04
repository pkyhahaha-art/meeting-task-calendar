-- Synthetic fixtures only; all auth users, meetings and queue rows roll back.
-- Do not call notification workers or providers.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); disabled_id uuid:=gen_random_uuid();
  meeting_id uuid:=gen_random_uuid(); missing_id uuid:=gen_random_uuid(); failed_new_id uuid:=gen_random_uuid();
  first_at timestamptz:=date_trunc('second',now()+interval '2 days');
  payload jsonb; templates jsonb; fixture_reminder_id uuid; guest_id uuid; appointment_id uuid; delivery_id uuid;
begin
  if has_function_privilege('anon','public.save_meeting_event_v3(uuid,jsonb,text[],jsonb,boolean)','execute') then
    raise exception 'Anonymous client can save Meeting';
  end if;
  if not has_table_privilege('service_role','public.task_internal_recipients','select')
    or not has_function_privilege('service_role','public.occurrence_guest_emails(uuid,uuid)','execute') then
    raise exception 'Recipient checks lost service read access';
  end if;
  insert into auth.users(id,email,raw_user_meta_data) values
    (owner_id,'atomic-save-'||owner_id||'@gmail.com','{"full_name":"Atomic Owner"}'),
    (other_id,'atomic-save-'||other_id||'@gmail.com','{"full_name":"Atomic Other"}'),
    (disabled_id,'atomic-save-'||disabled_id||'@gmail.com','{"full_name":"Atomic Disabled"}');
  update public.profiles set status='active' where id in(owner_id,other_id);
  update public.profiles set status='disabled' where id=disabled_id;
  payload:=jsonb_build_object('title','Atomic fixture','description','Original','location','Room',
    'affiliation','Fixture unit','all_day',false,'start_datetime',first_at,'end_datetime',first_at+interval '1 hour',
    'recurrence_rule','FREQ=DAILY','recurrence_until',null,'recurrence_count',3,
    'email_notifications_enabled',true,'mobile_notifications_enabled',true);
  templates:=jsonb_build_array(jsonb_build_object('offset_value',0,'offset_unit','minute',
    'scheduled_at',first_at,'channel_email',true,'channel_line',true,'status','scheduled'));
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload,array[' fixture@gmail.com '],templates,true);
  reset role;
  if not exists(select 1 from public.events where id=meeting_id and not suppress_guest_notifications
    and email_notifications_enabled and mobile_notifications_enabled) then raise exception 'Saved channels/suppression are incorrect'; end if;
  if (select count(*) from public.event_occurrences where event_id=meeting_id)<>3 then raise exception 'Recurrence was not materialized'; end if;
  select id into fixture_reminder_id from public.reminders where event_id=meeting_id and occurrence_id is null;
  select id into guest_id from public.event_guests where event_id=meeting_id and occurrence_id is null;
  update public.reminders set status='completed' where id=fixture_reminder_id;
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload,array['fixture@gmail.com'],templates,true);
  reset role;
  if not exists(select 1 from public.reminders where id=fixture_reminder_id and status='completed')
    or (select count(*) from public.events where id=meeting_id)<>1 then raise exception 'Ambiguous-response retry reset reminders/duplicated Meeting'; end if;
  -- A failure after the event write and reminder replacement must roll back ALL
  -- writes, including guests/channels/occurrence details and old reminder rows.
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(meeting_id,payload||'{"title":"Must roll back","email_notifications_enabled":false}'::jsonb,
      array['changed@gmail.com'],templates||templates,false);
    reset role;
    raise exception 'Duplicate reminder fixture should fail';
  exception when unique_violation then reset role;
  end;
  if not exists(select 1 from public.events where id=meeting_id and title='Atomic fixture' and email_notifications_enabled and not suppress_guest_notifications)
    or not exists(select 1 from public.event_guests where id=guest_id and email='fixture@gmail.com')
    or not exists(select 1 from public.reminders where id=fixture_reminder_id and status='completed') then
    raise exception 'Partial Meeting save survived a failure';
  end if;
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(failed_new_id,payload,array['fixture@gmail.com'],templates||templates,true);
    reset role;
    raise exception 'Failed create fixture should fail';
  exception when unique_violation then reset role;
  end;
  if exists(select 1 from public.events where id=failed_new_id) then raise exception 'Failed create left an orphan Meeting'; end if;
  -- Preserve per-occurrence cancellation and the unchanged guest identity.
  select id into appointment_id from public.event_occurrences where event_id=meeting_id and occurrence_key=first_at+interval '1 day';
  perform public.cancel_meeting_occurrence(meeting_id,first_at+interval '1 day');
  update public.reminders set status='scheduled' where id=fixture_reminder_id;
  perform public.queue_notification(meeting_id,null,'owner','fixture@gmail.com','meeting_reminder','{}'::jsonb,first_at);
  select id into delivery_id from public.notification_deliveries where event_id=meeting_id order by created_at desc limit 1;
  update public.notification_deliveries set reminder_id=fixture_reminder_id where id=delivery_id;
  set local role authenticated;
  perform public.save_meeting_event_v3(meeting_id,payload||'{"title":"Changed draft"}'::jsonb,array['fixture@gmail.com'],templates,true);
  reset role;
  if not exists(select 1 from public.events where id=meeting_id and title='Changed draft' and notification_requested_at is null)
    or not exists(select 1 from public.event_guests where id=guest_id)
    or not exists(select 1 from public.event_occurrences where id=appointment_id and status='cancelled')
    or not exists(select 1 from public.notification_deliveries where id=delivery_id and status='skipped')
    then raise exception 'Changed draft lost exceptions/guest identity or silently requested an update'; end if;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(meeting_id,payload,'{}',templates,false);
    reset role;
    raise exception 'Other employee saved owner Meeting';
  exception when insufficient_privilege then reset role;
  end;
  perform set_config('request.jwt.claim.sub',disabled_id::text,true);
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(gen_random_uuid(),payload,'{}',templates,true);
    reset role;
    raise exception 'Disabled employee saved Meeting';
  exception when insufficient_privilege then reset role;
  end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin
    set local role authenticated;
    perform public.save_meeting_event_v3(missing_id,payload,'{}',templates,false);
    reset role;
    raise exception 'Missing edit silently created Meeting';
  exception when no_data_found then reset role;
  end;
end;
$$;
select 'PASS: atomic rollback, idempotent replay, changed draft, occurrence cancellation, pending delivery cancellation and authorization' as result;
rollback;
