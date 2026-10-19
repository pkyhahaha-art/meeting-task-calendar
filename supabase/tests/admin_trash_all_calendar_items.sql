-- ISOLATED-ONLY regression test. The runner must supply the exact new migration
-- as TEXT in transaction-local test.admin_trash_all_migration. Never install
-- the new RPCs in public or invoke public bulk Trash during this test.
-- Assemble: BEGIN; set_config(..., <local migration text>, true);
-- <this file without its outer BEGIN/ROLLBACK>; ROLLBACK.
begin;
do $setup$
declare ddl text:=current_setting('test.admin_trash_all_migration',true); item record; definition text;
  sequence_name text; expression text; fixture_schema constant text:='admin_trash_all_fixture';
begin
  if ddl is null or position('create function public.admin_trash_all_calendar_items' in ddl)=0 then
    raise exception 'Supply the exact local migration as test.admin_trash_all_migration; isolated test refuses to run without it';
  end if;
  if to_regnamespace(fixture_schema) is not null then raise exception 'Isolated fixture schema already exists'; end if;
  execute 'create schema admin_trash_all_fixture';
  execute 'create table admin_trash_all_fixture.auth_users(id uuid primary key)';
  perform set_config('search_path','pg_catalog',true);
  perform set_config('check_function_bodies','off',true);
  -- Structures only: no public rows, real Auth users or real Storage objects.
  for item in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('create table %I.%I (like public.%I including all)',fixture_schema,item.tablename,item.tablename);
  end loop;
  -- Exact existing business definitions, with all data references remapped.
  for item in select p.oid,p.proname,pg_get_functiondef(p.oid) definition,
      pg_get_function_identity_arguments(p.oid) arguments
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prokind='f' and l.lanname in('sql','plpgsql') order by p.oid loop
    definition:=replace(item.definition,'public.',fixture_schema||'.');
    execute definition;
    execute format('alter function %I.%I(%s) set search_path to %I,pg_catalog',fixture_schema,item.proname,
      replace(item.arguments,'public.',fixture_schema||'.'),fixture_schema);
  end loop;
  -- Remap copied defaults/checks. In particular, never consume a public serial
  -- sequence; INCLUDING IDENTITY already creates a new, isolated sequence.
  for item in select c.relname,a.attname,a.attidentity,pg_get_expr(d.adbin,d.adrelid) expression
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname=fixture_schema and c.relkind='r' loop
    expression:=item.expression;
    if item.attidentity<>'' then
      sequence_name:=pg_get_serial_sequence(format('%I.%I',fixture_schema,item.relname),item.attname);
      if sequence_name not like fixture_schema||'.%' then raise exception 'Identity sequence is not isolated'; end if;
    elsif expression like '%nextval(%' then
      sequence_name:=item.relname||'_'||item.attname||'_isolated_seq';
      execute format('create sequence %I.%I',fixture_schema,sequence_name);
      execute format('alter table %I.%I alter column %I set default nextval(%L::regclass)',
        fixture_schema,item.relname,item.attname,fixture_schema||'.'||sequence_name);
    elsif expression is not null and position('public.' in expression)>0 then
      execute format('alter table %I.%I alter column %I set default %s',fixture_schema,item.relname,item.attname,
        replace(expression,'public.',fixture_schema||'.'));
    end if;
  end loop;
  for item in select c.relname,k.conname,pg_get_constraintdef(k.oid) definition
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=fixture_schema and k.contype='c' loop
    if position('public.' in item.definition)>0 then
      execute format('alter table %I.%I drop constraint %I',fixture_schema,item.relname,item.conname);
      execute format('alter table %I.%I add constraint %I %s',fixture_schema,item.relname,item.conname,
        replace(item.definition,'public.',fixture_schema||'.'));
    end if;
  end loop;
  for item in select c.relname,k.conname,pg_get_constraintdef(k.oid) definition
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and k.contype='f' loop
    definition:=replace(replace(item.definition,'public.',fixture_schema||'.'),'auth.users',fixture_schema||'.auth_users');
    execute format('alter table %I.%I add constraint %I %s',fixture_schema,item.relname,item.conname,definition);
  end loop;
  for item in select pg_get_triggerdef(t.oid) definition from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal loop
    execute replace(item.definition,'public.',fixture_schema||'.');
  end loop;
  -- The new functions are not deployed to public, even temporarily.
  ddl:=regexp_replace(ddl,'^begin;[[:space:]]*','','im');
  ddl:=regexp_replace(ddl,'^commit;[[:space:]]*$','','im');
  ddl:=replace(ddl,'notify pgrst,''reload schema'';','');
  execute replace(ddl,'public.',fixture_schema||'.');
  perform set_config('check_function_bodies','on',true);
  execute 'grant usage on schema admin_trash_all_fixture to authenticated,anon';
  -- Safety assertions before any fixture can advance a sequence or fire a trigger.
  if exists(select 1 from pg_attrdef d join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=fixture_schema and pg_get_expr(d.adbin,d.adrelid) like '%public.%')
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=fixture_schema and position('public.' in p.prosrc)>0) then
    raise exception 'An isolated default/function still references public';
  end if;
end;
$setup$;

-- A later-batch failure exercises full rollback without replacing the old RPC.
create function admin_trash_all_fixture.check_bulk_atomicity()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if not exists(select 1 from pg_locks where pid=pg_backend_pid() and relation='admin_trash_all_fixture.tasks'::regclass
        and mode='ShareRowExclusiveLock' and granted)
      or not exists(select 1 from pg_locks where pid=pg_backend_pid() and relation='admin_trash_all_fixture.events'::regclass
        and mode='ShareRowExclusiveLock' and granted) then raise exception 'Calendar writer locks missing'; end if;
    if current_setting('test.force_bulk_failure',true)='true'
      and (select count(*) from admin_trash_all_fixture.tasks where deleted_at is not null)>110 then
      raise exception 'Synthetic later-batch failure';
    end if;
  end if;
  return new;
end;
$$;
create trigger zzz_test_bulk_atomicity before update on admin_trash_all_fixture.tasks
  for each row execute function admin_trash_all_fixture.check_bulk_atomicity();

do $tests$
#variable_conflict use_column
declare admin_id uuid:=gen_random_uuid(); owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
  member_id uuid:=gen_random_uuid(); disabled_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid();
  root_id uuid; child_a uuid; child_b uuid; task_id uuid; event_id uuid; replaced_id uuid;
  trashed_task uuid; trashed_event uuid; actor uuid; preview jsonb; answer jsonb; stale text;
  tasks_before integer; events_before integer; logs_before integer; trash_before jsonb; terminal_before jsonb;
  pending_ids uuid[]; terminal_ids uuid[]; reason text:='Isolated all-system test'; stamp timestamptz;
  original_timezone text:=current_setting('TimeZone');
begin
  perform set_config('request.jwt.claim.sub','',true);
  insert into admin_trash_all_fixture.auth_users(id) select unnest(array[admin_id,owner_a,owner_b,member_id,disabled_id,pending_id]);
  insert into admin_trash_all_fixture.profiles(id,full_name,email,role,status)
    select id,'Isolated User','isolated-'||id||'@gmail.com',
      case when id=any(array[admin_id,disabled_id,pending_id]) then 'admin' else 'user' end,
      case when id=disabled_id then 'disabled' when id=pending_id then 'pending_verification' else 'active' end
    from admin_trash_all_fixture.auth_users;
  insert into admin_trash_all_fixture.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,status,completed_at)
    select case when n%2=0 then owner_a else owner_b end,'Bulk Task '||n,'internal',owner_b,current_date+14,
      case when n%3=0 then 'completed' else 'pending' end,case when n%3=0 then now() else null end
    from generate_series(1,251) n;
  insert into admin_trash_all_fixture.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,recurrence_rule)
    values(owner_a,'Legacy root','internal',owner_b,current_date+14,'FREQ=DAILY') returning id into root_id;
  insert into admin_trash_all_fixture.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,recurrence_series_id)
    values(owner_a,'Legacy child A','internal',owner_b,current_date+15,root_id) returning id into child_a;
  insert into admin_trash_all_fixture.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,recurrence_series_id)
    values(owner_a,'Legacy child B','internal',owner_b,current_date+16,root_id) returning id into child_b;
  insert into admin_trash_all_fixture.events(owner_user_id,title,start_datetime,recurrence_rule,recurrence_count,suppress_guest_notifications)
    select case when n%2=0 then owner_a else owner_b end,'Bulk Meeting '||n,now()+interval '14 days',
      case when n%5=0 then 'FREQ=DAILY' else null end,case when n%5=0 then 3 else null end,true
    from generate_series(1,137) n;
  insert into admin_trash_all_fixture.tasks(creator_user_id,title,assignee_type,assignee_user_id,due_date,status,deleted_at)
    values(owner_a,'Already trashed Task','internal',owner_b,current_date+14,'cancelled',now()-interval '1 day') returning id into trashed_task;
  insert into admin_trash_all_fixture.events(owner_user_id,title,start_datetime,deleted_at,suppress_guest_notifications)
    values(owner_a,'Already trashed Meeting',now()+interval '14 days',now()-interval '1 day',true) returning id into trashed_event;
  select id into task_id from admin_trash_all_fixture.tasks where title='Bulk Task 1';
  select id into event_id from admin_trash_all_fixture.events where title='Bulk Meeting 5';
  insert into admin_trash_all_fixture.task_internal_recipients(task_id,user_id) values(task_id,owner_b);
  insert into admin_trash_all_fixture.task_attachments(task_id,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(task_id,'Task.pdf','application/pdf',1,owner_a||'/'||task_id||'/fixture.pdf',owner_a);
  insert into admin_trash_all_fixture.attachments(event_id,file_name,mime_type,file_size,storage_path,uploaded_by)
    values(event_id,'Meeting.pdf','application/pdf',1,owner_a||'/'||event_id||'/fixture.pdf',owner_a);
  insert into admin_trash_all_fixture.mobile_push_subscriptions(user_id,endpoint,p256dh,auth)
    values(owner_a,'https://fcm.googleapis.com/isolated-fixture','fixture','fixture');
  insert into admin_trash_all_fixture.task_reminders(task_id,reminder_key,scheduled_at,status)
    values(task_id,'due',now()+interval '14 days','scheduled'),(task_id,'1_day',now()+interval '13 days','completed');
  insert into admin_trash_all_fixture.reminders(event_id,offset_value,offset_unit,scheduled_at,status)
    values(event_id,0,'minute',now()+interval '14 days','scheduled'),(event_id,1,'day',now()+interval '13 days','completed');
  insert into admin_trash_all_fixture.notification_deliveries(task_id,event_id,recipient_type,recipient_reference,channel,
      idempotency_key,scheduled_at,status,template_key,payload)
    select task_id,event_id,'owner','isolated-fixture@gmail.com','email','isolated-'||state,now(),state,'task_reminder','{}'
      from unnest(array['queued','retry','processing','deferred_quota','sent','failed','skipped']) state;
  select array_agg(id) into pending_ids from admin_trash_all_fixture.notification_deliveries where status in('queued','retry','processing','deferred_quota');
  select array_agg(id),jsonb_agg(to_jsonb(d) order by id) into terminal_ids,terminal_before
    from admin_trash_all_fixture.notification_deliveries d where status in('sent','failed','skipped');
  select jsonb_build_object('task',(select to_jsonb(t) from admin_trash_all_fixture.tasks t where id=trashed_task),
    'meeting',(select to_jsonb(e) from admin_trash_all_fixture.events e where id=trashed_event)) into trash_before;
  tasks_before:=254; events_before:=137;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  preview:=admin_trash_all_fixture.admin_calendar_trash_preview();
  perform set_config('TimeZone','Asia/Bangkok',true);
  if (admin_trash_all_fixture.admin_calendar_trash_preview()->>'snapshot') is distinct from preview->>'snapshot' then
    raise exception 'Snapshot depends on caller timezone'; end if;
  perform set_config('TimeZone',original_timezone,true);
  if (preview->>'task_count')::integer<>tasks_before or (preview->>'meeting_count')::integer<>events_before
    or (preview->>'total_count')::integer<>391 then raise exception 'Unfiltered all-owner preview count mismatch: %',preview; end if;
  if has_function_privilege('authenticated','admin_trash_all_fixture.admin_calendar_trash_snapshot(uuid[],uuid[])','execute')
    or has_function_privilege('anon','admin_trash_all_fixture.admin_trash_all_calendar_items(text,text,text)','execute') then
    raise exception 'Private/anonymous execution privilege expanded'; end if;
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',' ','ลบทั้งหมด'); raise exception 'Blank reason accepted'; exception when invalid_parameter_value then null; end;
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',repeat('x',501),'ลบทั้งหมด'); raise exception 'Long reason accepted'; exception when invalid_parameter_value then null; end;
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,' ลบทั้งหมด'); raise exception 'Inexact confirmation accepted'; exception when invalid_parameter_value then null; end;
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items('invalid',reason,'ลบทั้งหมด'); raise exception 'Invalid snapshot accepted'; exception when invalid_parameter_value then null; end;
  execute 'reset role';
  -- Same counts and same timestamp but changed content must invalidate preview.
  select updated_at into stamp from admin_trash_all_fixture.tasks where id=task_id;
  update admin_trash_all_fixture.tasks set title='Changed after preview' where id=task_id;
  if (select updated_at from admin_trash_all_fixture.tasks where id=task_id)<>stamp then raise exception 'Same-timestamp fixture was not established'; end if;
  execute 'set local role authenticated';
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,'ลบทั้งหมด'); raise exception 'Stale content accepted'; exception when serialization_failure then null; end;
  preview:=admin_trash_all_fixture.admin_calendar_trash_preview();
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  insert into admin_trash_all_fixture.events(owner_user_id,title,start_datetime,suppress_guest_notifications)
    values(owner_a,'New after preview',now()+interval '15 days',true) returning id into replaced_id;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,'ลบทั้งหมด'); raise exception 'Stale count accepted'; exception when serialization_failure then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  delete from admin_trash_all_fixture.events where id=replaced_id;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  preview:=admin_trash_all_fixture.admin_calendar_trash_preview();
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  update admin_trash_all_fixture.tasks set id=gen_random_uuid() where title='Bulk Task 2';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,'ลบทั้งหมด'); raise exception 'Same-count stale membership accepted'; exception when serialization_failure then null; end;
  execute 'reset role';
  foreach actor in array array[member_id,disabled_id,pending_id] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    execute 'set local role authenticated';
    begin perform admin_trash_all_fixture.admin_calendar_trash_preview(); raise exception 'NonactiveAdmin preview accepted'; exception when insufficient_privilege then null; end;
    begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,'ลบทั้งหมด'); raise exception 'NonactiveAdmin bulk accepted'; exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role anon';
  begin perform admin_trash_all_fixture.admin_calendar_trash_preview(); raise exception 'Anonymous preview accepted'; exception when insufficient_privilege then null; end;
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,'ลบทั้งหมด'); raise exception 'Anonymous bulk accepted'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute 'set local role authenticated';
  preview:=admin_trash_all_fixture.admin_calendar_trash_preview();
  execute 'reset role';
  select count(*) into logs_before from admin_trash_all_fixture.audit_logs;
  perform set_config('test.force_bulk_failure','true',true);
  execute 'set local role authenticated';
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,'ลบทั้งหมด'); raise exception 'Later batch should fail';
  exception when raise_exception then if sqlerrm<>'Synthetic later-batch failure' then raise; end if; end;
  execute 'reset role';
  perform set_config('test.force_bulk_failure','false',true);
  if (select count(*) from admin_trash_all_fixture.tasks where deleted_at is null)<>tasks_before
    or (select count(*) from admin_trash_all_fixture.events where deleted_at is null)<>events_before
    or (select count(*) from admin_trash_all_fixture.audit_logs)<>logs_before
    or exists(select 1 from admin_trash_all_fixture.notification_deliveries where id=any(pending_ids) and status='skipped') then
    raise exception 'Later-batch failure left partial entity/audit/queue writes'; end if;
  execute 'set local role authenticated';
  answer:=admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot','  '||reason||'  ','ลบทั้งหมด');
  execute 'reset role';
  if answer<>preview-'snapshot' then raise exception 'Global completion counts do not match preview'; end if;
  if exists(select 1 from admin_trash_all_fixture.tasks where deleted_at is null)
    or exists(select 1 from admin_trash_all_fixture.events where deleted_at is null) then raise exception 'Global Trash skipped later pages'; end if;
  if (select count(*) from admin_trash_all_fixture.audit_logs where action='ADMIN_TASK_TRASHED')<>tasks_before
    or (select count(*) from admin_trash_all_fixture.audit_logs where action='ADMIN_MEETING_TRASHED')<>events_before
    or exists(select 1 from admin_trash_all_fixture.audit_logs where action in('ADMIN_TASK_TRASHED','ADMIN_MEETING_TRASHED','ADMIN_ALL_CALENDAR_TRASHED')
      and (actor_user_id<>admin_id or metadata->>'reason'<>reason)) then raise exception 'Per-item counts/actor/reason audit mismatch'; end if;
  if exists(select 1 from admin_trash_all_fixture.notification_deliveries where id=any(pending_ids) and status<>'skipped')
    or (select jsonb_agg(to_jsonb(d) order by id) from admin_trash_all_fixture.notification_deliveries d where id=any(terminal_ids))<>terminal_before then
    raise exception 'Pending/terminal delivery behavior regressed'; end if;
  if exists(select 1 from admin_trash_all_fixture.task_reminders where status='scheduled')
    or exists(select 1 from admin_trash_all_fixture.reminders where status='scheduled')
    or not exists(select 1 from admin_trash_all_fixture.notification_deliveries where template_key='task_cancelled' and status='queued') then
    raise exception 'Reminder cancellation or existing cancellation confirmation regressed'; end if;
  if (select count(*) from admin_trash_all_fixture.task_attachments)<>1
    or (select count(*) from admin_trash_all_fixture.attachments)<>1
    or (select count(*) from admin_trash_all_fixture.mobile_push_subscriptions)<>1
    or (select count(*) from admin_trash_all_fixture.profiles)<>6 then raise exception 'Unrelated records or documents were deleted'; end if;
  if trash_before<>jsonb_build_object('task',(select to_jsonb(t) from admin_trash_all_fixture.tasks t where id=trashed_task),
    'meeting',(select to_jsonb(e) from admin_trash_all_fixture.events e where id=trashed_event)) then raise exception 'Already trashed items changed'; end if;
  execute 'set local role authenticated';
  answer:=admin_trash_all_fixture.admin_calendar_trash_preview();
  if (answer->>'total_count')::integer<>0 then raise exception 'Empty preview mismatch'; end if;
  begin perform admin_trash_all_fixture.admin_trash_all_calendar_items(preview->>'snapshot',reason,'ลบทั้งหมด'); raise exception 'Used snapshot accepted'; exception when serialization_failure then null; end;
  execute 'reset role';
end;
$tests$;
select 'PASS: isolated all-system counts, stale snapshots, active Admin/exact confirmation, >100 atomic rollback, legacy ordering, audits, reminders and retained data' as result;
rollback;
