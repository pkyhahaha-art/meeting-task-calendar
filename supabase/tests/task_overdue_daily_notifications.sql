-- Run after 202610040006. Every fixture and isolation change is rolled back;
-- never invoke the notification worker (which would send real messages).
begin;
set local timezone = 'UTC';

-- Isolate queue scans from pre-existing schedules. These updates and any audit
-- side effects are visible only inside this test transaction and roll back.
update public.reminders set status='cancelled' where status='scheduled';
update public.task_reminders set status='cancelled' where status='scheduled';

do $$
declare
  creator uuid:=gen_random_uuid(); assignee uuid:=gen_random_uuid(); disabled uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid(); v_task_id uuid; v_reminder_id uuid;
  day_offset integer; channel_mode text; first_slot timestamptz;
  today_slot timestamptz:=((now() at time zone 'Asia/Bangkok')::date + time '09:00') at time zone 'Asia/Bangkok';
  before_nine boolean:=now()<today_slot; expected integer; actual integer; row_status text;
  task_state text;
  slot timestamptz; message jsonb;
begin
  -- Fixed clock checks cover the 09:00 boundary regardless of test run time.
  if public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-07 08:59:59+07') is not null
    or public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-08 08:59:59+07') is not null
    or public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-09 08:59:59+07') is not null
    then raise exception 'Queued before 09:00 Bangkok'; end if;
  if public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-07 09:00+07')
      <> '2026-10-07 09:00+07'::timestamptz
    or public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-08 09:00+07')
      <> '2026-10-08 09:00+07'::timestamptz
    or public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-09 23:59+07')
      <> '2026-10-09 09:00+07'::timestamptz
    or public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-10 09:00+07') is not null
    or public.task_overdue_reminder_slot('2026-10-07 09:00+07','2026-10-06 09:00+07') is not null
    then raise exception 'Three-day daily slot is incorrect'; end if;

  insert into auth.users(id,email,raw_user_meta_data) values
    (creator,'rollback-'||creator||'@gmail.com','{"full_name":"Overdue Creator"}'),
    (assignee,'rollback-'||assignee||'@gmail.com','{"full_name":"Overdue Assignee"}'),
    (disabled,'rollback-'||disabled||'@gmail.com','{"full_name":"Disabled Assignee"}'),
    (outsider,'rollback-'||outsider||'@gmail.com','{"full_name":"Unrelated Member"}');
  update public.profiles set status='active' where id in(creator,assignee,outsider);
  update public.profiles set status='disabled' where id=disabled;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth) values
    (creator,'https://web.push.apple.com/rollback-'||creator,'fixture','fixture'),
    (assignee,'https://fcm.googleapis.com/rollback-'||assignee,'fixture','fixture'),
    (disabled,'https://fcm.googleapis.com/rollback-'||disabled,'fixture','fixture'),
    (outsider,'https://fcm.googleapis.com/rollback-'||outsider,'fixture','fixture');
  insert into public.line_connections(user_id,line_user_id) values
    (creator,'rollback-line-'||creator),(assignee,'rollback-line-'||assignee);
  perform set_config('request.jwt.claim.sub',creator::text,true);

  for day_offset in 0..3 loop
    foreach channel_mode in array array['email','push','both'] loop
      first_slot:=today_slot-day_offset*interval '1 day';
      insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date)
        values(creator,'internal',assignee,'Overdue rollback fixture',
          (today_slot at time zone 'Asia/Bangkok')::date) returning id into v_task_id;
      -- Past creation is forbidden. Model an existing task through the
      -- creator's permitted update path, without disabling any triggers.
      update public.tasks set due_date=(first_slot at time zone 'Asia/Bangkok')::date-1
        where id=v_task_id;
      insert into public.task_internal_recipients(task_id,user_id) values
        (v_task_id,creator),(v_task_id,assignee),(v_task_id,disabled) on conflict do nothing;
      insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,channel_line)
        values(v_task_id,'overdue',first_slot,channel_mode in('email','both'),channel_mode in('push','both'))
        returning id into v_reminder_id;
      -- Simulate an existing reminder that was scheduled before its deadline;
      -- inserting a past schedule directly invokes skip_past_task_reminder.
      update public.task_reminders set status='scheduled' where id=v_reminder_id;
      -- Production order, twice: same creator is also an assignee, but gets
      -- exactly one delivery per channel; worker retry does not enqueue again.
      perform public.queue_due_line_reminders();
      perform public.queue_due_email_reminders();
      perform public.queue_due_line_reminders();
      perform public.queue_due_email_reminders();
      expected:=case when day_offset<=2 and not before_nine then 2 else 0 end;
      select count(*) into actual from public.notification_deliveries d
        where d.task_reminder_id=v_reminder_id and d.channel='push';
      if actual<>(case when channel_mode in('push','both') then expected else 0 end)
        then raise exception 'Incorrect Push count: day %, mode %, got %',day_offset,channel_mode,actual; end if;
      select count(*) into actual from public.notification_deliveries d
        where d.task_reminder_id=v_reminder_id and d.channel='email';
      if actual<>(case when channel_mode in('email','both') then expected else 0 end)
        then raise exception 'Incorrect email count: day %, mode %, got %',day_offset,channel_mode,actual; end if;
      select count(*) into actual from public.notification_deliveries d
        where d.task_reminder_id=v_reminder_id and d.channel='line';
      if actual<>(case when channel_mode in('push','both') then expected else 0 end)
        then raise exception 'LINE retry duplicated delivery: day %, mode %, got %',day_offset,channel_mode,actual; end if;
      if exists(select 1 from public.notification_deliveries d where d.task_reminder_id=v_reminder_id and d.channel='line'
        and d.scheduled_at<>first_slot) then raise exception 'LINE original schedule changed'; end if;
      if exists(select 1 from public.notification_deliveries d where d.task_reminder_id=v_reminder_id and d.channel in('email','push')
        and (d.scheduled_at<>today_slot or d.payload->>'reminder_key'<>'overdue'
          or (d.payload->>'reminder_scheduled_at')::timestamptz<>today_slot
          or (d.channel='push' and d.payload->>'push_user_id' not in(creator::text,assignee::text))))
        then raise exception 'Wrong daily timestamp, marker, or recipient'; end if;
      select r.status into row_status from public.task_reminders r where r.id=v_reminder_id;
      if day_offset>2 and row_status<>'completed'
        or day_offset=2 and not before_nine and row_status<>'completed'
        or day_offset<2 and row_status<>'scheduled'
        or day_offset=2 and before_nine and row_status<>'scheduled'
        then raise exception 'Wrong shared row lifecycle: day %, mode %, status %',day_offset,channel_mode,row_status; end if;
    end loop;
  end loop;

  -- Closing, cancelling or deleting a task stops new overdue queue entries.
  foreach task_state in array array['completed','cancelled','deleted'] loop
    insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date)
      values(creator,'internal',assignee,'Stopped overdue rollback fixture',
        (today_slot at time zone 'Asia/Bangkok')::date) returning id into v_task_id;
    update public.tasks set due_date=(today_slot at time zone 'Asia/Bangkok')::date-2
      where id=v_task_id;
    if task_state='deleted' then
      update public.tasks set deleted_at=now() where id=v_task_id;
    else
      update public.tasks set status=task_state where id=v_task_id;
    end if;
    insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,channel_line)
      values(v_task_id,'overdue',today_slot-interval '1 day',true,true) returning id into v_reminder_id;
    update public.task_reminders set status='scheduled' where id=v_reminder_id;
    perform public.queue_due_line_reminders();
    perform public.queue_due_email_reminders();
    if exists(select 1 from public.notification_deliveries d where d.task_reminder_id=v_reminder_id)
      then raise exception 'Stopped task queued a reminder: %',task_state; end if;
    if not exists(select 1 from public.task_reminders r where r.id=v_reminder_id and r.status='cancelled')
      then raise exception 'Stopped task reminder was not cancelled'; end if;
  end loop;
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date)
    values(creator,'internal',assignee,'Rescheduled overdue fixture',
      (today_slot at time zone 'Asia/Bangkok')::date+5) returning id into v_task_id;
  insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,channel_line)
    values(v_task_id,'overdue',today_slot-interval '1 day',true,true) returning id into v_reminder_id;
  update public.task_reminders set status='scheduled' where id=v_reminder_id;
  perform public.queue_due_line_reminders();
  perform public.queue_due_email_reminders();
  if exists(select 1 from public.notification_deliveries d where d.task_reminder_id=v_reminder_id)
    or not exists(select 1 from public.task_reminders r where r.id=v_reminder_id and r.status='cancelled')
    then raise exception 'Rescheduled task kept its old overdue reminder'; end if;

  -- The same reminder ID must support three independent daily idempotency
  -- keys. Exercise the actual delivery helpers without changing wall clocks.
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,due_date)
    values(creator,'internal',assignee,'Three daily keys fixture',
      (today_slot at time zone 'Asia/Bangkok')::date+5) returning id into v_task_id;
  first_slot:=today_slot+interval '6 days';
  insert into public.task_reminders(task_id,reminder_key,scheduled_at,channel_email,channel_line)
    values(v_task_id,'overdue',first_slot,true,true) returning id into v_reminder_id;
  for day_offset in 0..2 loop
    slot:=public.task_overdue_reminder_slot(first_slot,first_slot+day_offset*interval '1 day');
    message:=jsonb_build_object('entity','task','id',v_task_id,'reminder_key','overdue',
      'reminder_scheduled_at',slot);
    for actual in 1..2 loop
      perform public.queue_email_reminder_delivery(v_reminder_id,null,v_task_id,'task_creator',
        'rollback-'||creator||'@gmail.com','task_reminder',message,slot);
      perform public.queue_push_reminder_delivery(v_reminder_id,null,v_task_id,'task_creator',
        creator,'task_reminder',message,slot);
    end loop;
  end loop;
  if (select count(*) from public.notification_deliveries d where d.task_reminder_id=v_reminder_id)<>6
    or (select count(distinct d.scheduled_at) from public.notification_deliveries d where d.task_reminder_id=v_reminder_id)<>3
    then raise exception 'Same reminder did not produce exactly three daily deliveries per channel'; end if;
  if has_function_privilege('anon','public.queue_due_line_reminders()','execute')
    or has_function_privilege('authenticated','public.queue_due_email_reminders()','execute')
    or has_function_privilege('anon','public.task_overdue_reminder_slot(timestamptz,timestamptz)','execute')
    then raise exception 'Queue helpers exposed to client roles'; end if;
end;
$$;
select 'PASS: overdue daily slot, three-day limit, channel selection, active recipients, deduplication, stopped tasks and private helpers' as result;
rollback;
