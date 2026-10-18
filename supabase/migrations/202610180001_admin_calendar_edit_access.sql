-- Active Admins may edit calendar content without impersonating its creator.
-- Parent deletion, Task completion and private document recipient rights remain separate.
begin;

create or replace function public.can_manage_event(target_event_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_user() and exists(select 1 from public.events e where e.id=target_event_id
    and (e.owner_user_id=auth.uid() or (public.is_admin() and e.deleted_at is null)));
$$;

create or replace function public.can_manage_task(target_task_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_user() and exists(select 1 from public.tasks t where t.id=target_task_id
    and (t.creator_user_id=auth.uid() or (public.is_admin() and t.deleted_at is null)));
$$;
revoke all on function public.can_manage_task(uuid) from public,anon;
grant execute on function public.can_manage_task(uuid) to authenticated;

create policy events_admin_edit on public.events for update to authenticated
  using(public.is_admin() and deleted_at is null)
  with check(public.is_admin() and deleted_at is null);
create policy tasks_admin_edit on public.tasks for update to authenticated
  using(public.is_admin() and deleted_at is null)
  with check(public.is_admin() and deleted_at is null);

-- Occurrence edits go through the existing validated RPC. Broadening a helper
-- must not grant direct occurrence deletion, insertion or status resurrection.
drop policy occurrence_owner_all on public.event_occurrences;
create policy occurrence_owner_all on public.event_occurrences for all to authenticated
  using(public.is_active_user() and exists(select 1 from public.events e
    where e.id=event_occurrences.event_id and e.owner_user_id=auth.uid()))
  with check(public.is_active_user() and exists(select 1 from public.events e
    where e.id=event_occurrences.event_id and e.owner_user_id=auth.uid()));

create or replace function public.guard_admin_event_edit()
returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is null or old.owner_user_id=auth.uid() then return new; end if;
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active' for share;
  if not found then raise exception 'active Admin required to edit another creator Meeting' using errcode='42501'; end if;
  -- The existing reason/audit-protected Admin Trash RPC is the sole exception.
  if current_user=pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
      where p.oid='public.admin_trash_calendar_items(jsonb,text)'::regprocedure))
    and old.deleted_at is null and new.deleted_at is not null
    and (to_jsonb(new)-array['deleted_at','updated_at'])=(to_jsonb(old)-array['deleted_at','updated_at']) then return new; end if;
  if old.deleted_at is not null or new.deleted_at is not null
    or (to_jsonb(new)-array['title','description','location','affiliation','all_day','start_datetime','end_datetime',
      'recurrence_rule','recurrence_until','recurrence_count','email_notifications_enabled','mobile_notifications_enabled',
      'notification_requested_at','suppress_guest_notifications','updated_at'])
      is distinct from (to_jsonb(old)-array['title','description','location','affiliation','all_day','start_datetime','end_datetime',
      'recurrence_rule','recurrence_until','recurrence_count','email_notifications_enabled','mobile_notifications_enabled',
      'notification_requested_at','suppress_guest_notifications','updated_at']) then
    raise exception 'Admin edits cannot change Meeting identity, status or Trash state' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_admin_event_edit() from public,anon,authenticated;
create trigger z_admin_event_edit_guard before update on public.events for each row execute function public.guard_admin_event_edit();

create or replace function public.task_creator_mobile_available(target_task_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare creator uuid;
begin
  if auth.uid() is null or not public.can_manage_task(target_task_id) then
    raise exception 'only the active creator or Admin may check Task mobile availability' using errcode='42501';
  end if;
  select t.creator_user_id into creator from public.tasks t where t.id=target_task_id and t.deleted_at is null;
  return exists(select 1 from public.mobile_push_subscriptions d join public.profiles p on p.id=d.user_id
    where p.id=creator and p.status='active' and d.endpoint like 'https://%');
end;
$$;
revoke all on function public.task_creator_mobile_available(uuid) from public,anon;
grant execute on function public.task_creator_mobile_available(uuid) to authenticated;

create policy task_reminders_admin_edit on public.task_reminders for all to authenticated
  using(public.is_admin() and public.can_manage_task(task_id))
  with check(public.is_admin() and public.can_manage_task(task_id));
create policy task_attachments_admin_insert on public.task_attachments for insert to authenticated
  with check(public.is_admin() and public.can_manage_task(task_id) and uploaded_by=auth.uid()
    and storage_path like auth.uid()::text||'/'||task_id::text||'/%');
create policy task_attachments_admin_delete on public.task_attachments for delete to authenticated
  using(public.is_admin() and public.can_manage_task(task_id));
create policy document_links_admin_edit on public.document_links for all to authenticated
  using(public.is_admin() and ((task_id is not null and public.can_manage_task(task_id))
    or (event_id is not null and public.can_manage_event(event_id))))
  with check(public.is_admin() and ((task_id is not null and public.can_manage_task(task_id))
    or (event_id is not null and public.can_manage_event(event_id))));

create policy storage_calendar_admin_insert on storage.objects for insert to authenticated
  with check(public.is_admin() and (storage.foldername(name))[1]=auth.uid()::text and
    ((bucket_id='task-documents' and exists(select 1 from public.tasks t
        where t.id::text=(storage.foldername(name))[2] and t.deleted_at is null))
      or (bucket_id='meeting-documents' and exists(select 1 from public.events e
        where e.id::text=(storage.foldername(name))[2] and e.deleted_at is null))));
create policy storage_task_admin_delete on storage.objects for delete to authenticated
  using(public.is_admin() and bucket_id='task-documents' and
    (exists(select 1 from public.task_attachments a join public.tasks t on t.id=a.task_id
      where a.storage_path=name and t.deleted_at is null)
    or ((storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.tasks t
      where t.id::text=(storage.foldername(name))[2] and t.deleted_at is null))));
-- Allow cleanup of an Admin's just-uploaded file if attachment metadata failed.
create policy storage_meeting_admin_cleanup on storage.objects for delete to authenticated
  using(public.is_admin() and bucket_id='meeting-documents' and (storage.foldername(name))[1]=auth.uid()::text
    and exists(select 1 from public.events e where e.id::text=(storage.foldername(name))[2] and e.deleted_at is null));

create or replace function public.guard_admin_calendar_child_edit()
returns trigger language plpgsql set search_path='' as $$
declare before_row jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row jsonb:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  item jsonb:=coalesce(after_row,before_row); creator uuid; previous_creator uuid; parent uuid; allowed text[];
begin
  if auth.uid() is null then return coalesce(new,old); end if;
  if item->>'event_id' is not null then
    parent:=(item->>'event_id')::uuid;
    select e.owner_user_id into creator from public.events e where e.id=parent;
  else
    parent:=(item->>'task_id')::uuid;
    select t.creator_user_id into creator from public.tasks t where t.id=parent;
  end if;
  -- Resolve BOTH parents before the owner fast path. An Admin cannot move a
  -- foreign child under their own item to hide its original ownership/audit.
  if tg_op='UPDATE' and public.is_admin() and
    (before_row->'event_id' is distinct from after_row->'event_id'
      or before_row->'task_id' is distinct from after_row->'task_id') then
    if before_row->>'event_id' is not null then
      select e.owner_user_id into previous_creator from public.events e where e.id=(before_row->>'event_id')::uuid;
    else
      select t.creator_user_id into previous_creator from public.tasks t where t.id=(before_row->>'task_id')::uuid;
    end if;
    if previous_creator is distinct from auth.uid() or creator is distinct from auth.uid() then
      raise exception 'Admin edits cannot reparent another creator child record' using errcode='42501';
    end if;
  end if;
  if creator=auth.uid() or not public.is_admin() then return coalesce(new,old); end if;
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active' for share;
  if not found then raise exception 'active Admin required' using errcode='42501'; end if;
  if (item->>'event_id' is not null and not exists(select 1 from public.events e where e.id=parent and e.deleted_at is null))
    or (item->>'task_id' is not null and not exists(select 1 from public.tasks t where t.id=parent and t.deleted_at is null)) then
    raise exception 'Cannot edit documents or recipients in Trash' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    -- An Admin who is also an assignee still acknowledges their own recipient
    -- row through the existing acknowledge RPC, just like another employee.
    if tg_table_name='task_internal_recipients' and before_row->>'user_id'=auth.uid()::text
      and (before_row-'acknowledged_at')=(after_row-'acknowledged_at') then return new; end if;
    allowed:=case tg_table_name
      when 'attachments' then array['file_name','mime_type','file_size']
      when 'task_attachments' then array['file_name','mime_type','file_size']
      when 'document_links' then array['display_name','url']
      when 'event_guests' then array['email','revoked_at']
      when 'task_internal_recipients' then array[]::text[]
      when 'task_external_recipients' then array['email']
      else array['offset_value','offset_unit','scheduled_at','channel_email','channel_line','status','updated_at'] end;
    if (before_row-allowed) is distinct from (after_row-allowed) then
      raise exception 'Admin edits cannot move existing child records or overwrite their identity' using errcode='42501';
    end if;
  end if;
  if tg_op='INSERT' and tg_table_name in ('attachments','task_attachments') and
    (item->>'uploaded_by' is distinct from auth.uid()::text or
      not((item->>'storage_path') like auth.uid()::text||'/'||parent::text||'/%')) then
    raise exception 'Admin uploads must record the actual uploader and entity path' using errcode='42501';
  end if;
  if tg_op='INSERT' and tg_table_name='document_links' and item->>'added_by' is distinct from auth.uid()::text then
    raise exception 'Admin links must record the actual actor' using errcode='42501';
  end if;
  if tg_table_name='attachments' and item->>'occurrence_id' is not null and not exists(
    select 1 from public.event_occurrences o where o.id=(item->>'occurrence_id')::uuid and o.event_id=parent) then
    raise exception 'Attachment appointment does not belong to the Meeting' using errcode='42501';
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function public.guard_admin_calendar_child_edit() from public,anon,authenticated;

create or replace function public.audit_admin_calendar_edit()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  after_row jsonb:=case when tg_op='DELETE' then null else to_jsonb(new) end;
  item jsonb:=coalesce(after_row,before_row); creator uuid; parent uuid; entity text;
  safe_keys text[]; safe_before jsonb; safe_after jsonb;
begin
  if auth.uid() is null or not public.is_admin() then return coalesce(new,old); end if;
  if tg_table_name='events' then parent:=(item->>'id')::uuid; creator:=(item->>'owner_user_id')::uuid; entity:='event';
  elsif tg_table_name='tasks' then parent:=(item->>'id')::uuid; creator:=(item->>'creator_user_id')::uuid; entity:='task';
  elsif item->>'event_id' is not null then
    parent:=(item->>'event_id')::uuid; entity:='event';
    select e.owner_user_id into creator from public.events e where e.id=parent;
  else
    parent:=(item->>'task_id')::uuid; entity:='task';
    select t.creator_user_id into creator from public.tasks t where t.id=parent;
  end if;
  if creator is null or creator=auth.uid() then return coalesce(new,old); end if;
  safe_keys:=case tg_table_name
    when 'events' then array['title','description','location','affiliation','all_day','start_datetime','end_datetime',
      'recurrence_rule','recurrence_until','recurrence_count','email_notifications_enabled','mobile_notifications_enabled','notification_requested_at']
    when 'tasks' then array['title','description','affiliation','due_date','due_time','assignee_type','assignee_user_id',
      'external_assignee_email','linked_event_id','recurrence_rule','notification_requested_at']
    when 'event_occurrences' then array['description','location']
    when 'attachments' then array['id','file_name','mime_type','file_size','uploaded_by','scope','occurrence_id']
    when 'task_attachments' then array['id','file_name','mime_type','file_size','uploaded_by']
    when 'document_links' then array['id','display_name','added_by']
    when 'event_guests' then array['id','email','occurrence_id','revoked_at']
    when 'task_internal_recipients' then array['task_id','user_id']
    when 'task_external_recipients' then array['id','email']
    else array['id','occurrence_id','offset_value','offset_unit','reminder_key','scheduled_at','channel_email','channel_line','status'] end;
  if tg_table_name='event_occurrences' then
    before_row:=before_row->'override_payload'; after_row:=after_row->'override_payload';
  end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe_before from jsonb_each(coalesce(before_row,'{}')) where key=any(safe_keys);
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe_after from jsonb_each(coalesce(after_row,'{}')) where key=any(safe_keys);
  if safe_before=safe_after and not(tg_table_name='document_links' and before_row->>'url' is distinct from after_row->>'url') then return coalesce(new,old); end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'ADMIN_CALENDAR_EDIT',entity,parent::text,jsonb_build_object('table',tg_table_name,
      'operation',tg_op,'creator_user_id',creator,'before',safe_before,'after',safe_after,
      'link_changed',tg_table_name='document_links' and before_row->>'url' is distinct from after_row->>'url'));
  return coalesce(new,old);
end;
$$;
revoke all on function public.audit_admin_calendar_edit() from public,anon,authenticated;

do $$
declare child_table text;
begin
  foreach child_table in array array['event_guests','reminders','attachments','task_reminders','task_attachments',
    'document_links','task_internal_recipients','task_external_recipients'] loop
    execute format('create trigger admin_calendar_child_guard before insert or update or delete on public.%I for each row execute function public.guard_admin_calendar_child_edit()',child_table);
  end loop;
  foreach child_table in array array['events','tasks','event_occurrences','event_guests','reminders','attachments',
    'task_reminders','task_attachments','document_links','task_internal_recipients','task_external_recipients'] loop
    execute format('create trigger admin_calendar_edit_audit after insert or update or delete on public.%I for each row execute function public.audit_admin_calendar_edit()',child_table);
  end loop;
end;
$$;

create or replace function public.protect_task_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  if old.creator_user_id<>auth.uid() or new.creator_user_id<>old.creator_user_id then
    if public.is_admin()
      and current_user=pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
        where p.oid='public.admin_trash_calendar_items(jsonb,text)'::regprocedure))
      and current_setting('app.admin_calendar_trash',true)=auth.uid()::text
      and old.deleted_at is null and new.deleted_at is not null and new.status='cancelled'
      and (to_jsonb(new)-array['status','deleted_at','updated_at'])=(to_jsonb(old)-array['status','deleted_at','updated_at']) then
      return new;
    end if;
    if public.is_admin() and old.deleted_at is null and new.deleted_at is null
      and (to_jsonb(new)-array['title','description','affiliation','due_date','due_time','assignee_type','assignee_user_id',
        'external_assignee_email','linked_event_id','notification_requested_at','updated_at'])
        =(to_jsonb(old)-array['title','description','affiliation','due_date','due_time','assignee_type','assignee_user_id',
        'external_assignee_email','linked_event_id','notification_requested_at','updated_at']) then
      perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active' for share;
      if found then return new; end if;
    end if;
    raise exception 'only the creator changes Task identity, completion or Trash state' using errcode='42501';
  end if;
  return new;
end;
$$;

create or replace function public.replace_task_internal_recipients(target_task_id uuid, recipient_user_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare task_row public.tasks; normalized uuid[];
begin
  select * into task_row from public.tasks where id = target_task_id for update;
  if not found or not public.can_manage_task(target_task_id) then
    raise exception 'only the active creator or Admin may manage recipients' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct user_id), '{}'::uuid[]) into normalized
  from unnest(coalesce(recipient_user_ids, '{}'::uuid[])) as recipient(user_id);
  if exists (select 1 from unnest(normalized) as recipient(user_id)
    where not exists (select 1 from public.profiles profile
      where profile.id = recipient.user_id and profile.status = 'active')) then
    raise exception 'all internal recipients must be active';
  end if;
  if task_row.assignee_type = 'internal' and not (task_row.assignee_user_id = any(normalized)) then
    raise exception 'primary internal recipient must be included';
  end if;
  delete from public.task_internal_recipients recipient
    where recipient.task_id = target_task_id and not (recipient.user_id = any(normalized));
  insert into public.task_internal_recipients (task_id, user_id)
    select target_task_id, recipient.user_id from unnest(normalized) as recipient(user_id)
    on conflict do nothing;
end;
$$;

create or replace function public.replace_task_external_recipients(target_task_id uuid, recipient_emails text[])
returns void language plpgsql security definer set search_path = '' as $$
declare task_row public.tasks; normalized text[];
begin
  select * into task_row from public.tasks where id = target_task_id for update;
  if not found or not public.can_manage_task(target_task_id) then
    raise exception 'only the active creator or Admin may manage recipients' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct lower(trim(raw_email))), '{}'::text[]) into normalized
    from unnest(coalesce(recipient_emails, '{}'::text[])) as recipient(raw_email)
    where trim(raw_email) <> '';
  if exists (select 1 from unnest(normalized) as recipient(email)
    where recipient.email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@gmail[.]com$') then
    raise exception 'external recipients must be valid Gmail addresses';
  end if;
  if task_row.assignee_type = 'external' and not (task_row.external_assignee_email = any(normalized)) then
    raise exception 'primary external recipient must be included';
  end if;
  delete from public.task_external_recipients recipient
    where recipient.task_id = target_task_id and not (recipient.email = any(normalized));
  insert into public.task_external_recipients (task_id, email)
    select target_task_id, recipient.email from unnest(normalized) as recipient(email)
    on conflict (task_id, email) do nothing;
end;
$$;

create or replace function public.queue_task_update_mobile_notifications(target_task_id uuid,target_requested_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare task public.tasks; queued integer;
begin
  select * into task from public.tasks where id=target_task_id;
  if not found or not public.can_manage_task(target_task_id) then
    raise exception 'only the active creator or Admin may notify an update' using errcode='42501';
  end if;
  if task.deleted_at is not null or task.status<>'pending' or target_requested_at is null
    or task.notification_requested_at is distinct from target_requested_at then return 0; end if;
  insert into public.notification_deliveries(task_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload)
  select task.id,case when device.user_id=task.creator_user_id then 'task_creator' else 'task_assignee' end,
    device.id::text,'push',concat('task-mobile:',task.id,':task_updated:',extract(epoch from target_requested_at),':',device.id),
    now(),'task_updated',jsonb_build_object('entity','task','id',task.id,'title',task.title,
      'affiliation',task.affiliation,'description',task.description,'due_date',task.due_date,'due_time',task.due_time,
      'status',task.status,'push_user_id',device.user_id)
  from public.mobile_push_subscriptions device join public.profiles p on p.id=device.user_id and p.status='active'
  where device.endpoint like 'https://%' and (device.user_id=task.creator_user_id
    or device.user_id=task.assignee_user_id or exists(select 1 from public.task_internal_recipients r where r.task_id=task.id and r.user_id=device.user_id))
  on conflict(idempotency_key) do nothing;
  get diagnostics queued=row_count;
  return queued;
end;
$$;

create or replace function public.cancel_meeting_occurrence_internal(target_event_id uuid,target_occurrence_start timestamptz,target_notify boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences;
begin
  if auth.uid() is null or not public.is_active_user() or not exists(select 1 from public.events e where e.id=target_event_id and e.owner_user_id=auth.uid()) then
    raise exception 'only the owner or Admin can cancel this appointment' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id for update;
  if not found or meeting.recurrence_rule is null or meeting.status<>'scheduled' or meeting.deleted_at is not null then
    raise exception 'a scheduled recurring Meeting is required';
  end if;
  select * into appointment from public.event_occurrences
    where event_id=target_event_id and occurrence_key=target_occurrence_start for update;
  if not found or appointment.start_datetime<=now() then raise exception 'a future appointment is required'; end if;
  if appointment.status='cancelled' then return appointment.id; end if;
  if appointment.status<>'scheduled' then raise exception 'a scheduled appointment is required'; end if;
  update public.event_occurrences set status='cancelled',
    override_payload=(override_payload-'recurrence_removed')||'{"cancelled_individually":true}'::jsonb
    where id=appointment.id;
  update public.notification_deliveries d set status='skipped',error_code='appointment_cancelled',
    error_message='This appointment was cancelled individually'
    from public.reminders r where d.reminder_id=r.id and r.event_id=meeting.id
      and (r.occurrence_id=appointment.id or (r.occurrence_id is null and appointment.occurrence_key=meeting.start_datetime))
      and d.status in ('queued','retry');
  update public.reminders set status='cancelled' where event_id=meeting.id
    and (occurrence_id=appointment.id or (occurrence_id is null and appointment.occurrence_key=meeting.start_datetime))
    and status in ('scheduled','processing');
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'MEETING_OCCURRENCE_CANCELLED','event_occurrence',appointment.id::text,
      jsonb_build_object('event_id',meeting.id,'start_datetime',appointment.start_datetime));
  if target_notify then
    perform public.queue_meeting_occurrence_action(meeting.id,appointment.id,appointment.start_datetime,null,meeting.id,appointment.id);
  end if;
  return appointment.id;
end;
$$;

create or replace function public.detach_meeting_occurrence(
  target_event_id uuid,target_occurrence_start timestamptz,target_new_start timestamptz,
  target_description text,target_location text,target_guest_emails text[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences; new_id uuid; desired_emails text[];

begin
  if auth.uid() is null or not public.is_active_user() or not exists(select 1 from public.events e where e.id=target_event_id and e.owner_user_id=auth.uid()) then
    raise exception 'only the owner or Admin can move this appointment' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id for update;
  if not found or meeting.recurrence_rule is null or meeting.status<>'scheduled' or meeting.deleted_at is not null then
    raise exception 'a scheduled recurring Meeting is required';
  end if;
  select * into appointment from public.event_occurrences where event_id=meeting.id
    and occurrence_key=target_occurrence_start for update;
  if not found then raise exception 'appointment not found'; end if;
  if appointment.override_payload->>'moved_event_id' is not null then
    return (appointment.override_payload->>'moved_event_id')::uuid;
  end if;
  if appointment.status<>'scheduled' or appointment.start_datetime<=now() or target_new_start<=now()
    or target_new_start is null or target_new_start=appointment.start_datetime then
    raise exception 'two distinct future appointment dates are required';
  end if;
  select coalesce(array_agg(email),'{}'::text[]) into desired_emails from (
    select distinct lower(btrim(value)) email from unnest(target_guest_emails) value where btrim(value)<>''
  ) normalized;
  if cardinality(desired_emails)>100 or exists(select 1 from unnest(desired_emails) email
    where email !~ '^[^@[:space:]]+@gmail[.]com$') then raise exception 'invalid attendee Gmail addresses'; end if;
  insert into public.events(owner_user_id,title,description,location,affiliation,start_datetime,end_datetime,
    all_day,timezone,suppress_guest_notifications,email_notifications_enabled,mobile_notifications_enabled)
  values(meeting.owner_user_id,meeting.title,btrim(coalesce(target_description,'')),btrim(coalesce(target_location,'')),
    meeting.affiliation,target_new_start,
    case when appointment.end_datetime is null then null else target_new_start+(appointment.end_datetime-appointment.start_datetime) end,
    meeting.all_day,meeting.timezone,true,meeting.email_notifications_enabled,meeting.mobile_notifications_enabled)
  returning id into new_id;
  insert into public.event_guests(event_id,email) select new_id,email from unnest(desired_emails) email;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    select new_id,r.offset_value,r.offset_unit,
      target_new_start-case r.offset_unit when 'minute' then make_interval(mins=>r.offset_value)
        when 'hour' then make_interval(hours=>r.offset_value) when 'day' then make_interval(days=>r.offset_value)
        when 'week' then make_interval(days=>r.offset_value*7) when 'month' then make_interval(months=>r.offset_value) end,
      r.channel_email,r.channel_line from public.reminders r where r.event_id=meeting.id
      and (r.occurrence_id=appointment.id or (r.occurrence_id is null and appointment.occurrence_key=meeting.start_datetime));
  perform public.cancel_meeting_occurrence_internal(meeting.id,appointment.occurrence_key,false);
  update public.event_occurrences set override_payload=override_payload||jsonb_build_object('moved_event_id',new_id)
    where id=appointment.id;
  update public.events set suppress_guest_notifications=false where id=new_id;
  if meeting.initial_notification_requested_at is not null and meeting.email_notifications_enabled then
    update public.events set initial_notification_requested_at=now() where id=new_id;
  end if;
  perform public.queue_meeting_occurrence_action(new_id,null,appointment.start_datetime,target_new_start,meeting.id,appointment.id);
  return new_id;
end;
$$;

-- Editing authority does not authorize first-time creator confirmations or
-- invitations. Keep the initial paths explicitly tied to the actual creator.
create or replace function public.queue_meeting_initial_notifications(target_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare event_row public.events; owner_email text; guest_row record; payload jsonb; notification_count integer := 0;
begin
  if auth.uid() is null or not public.is_active_user() or not exists(
    select 1 from public.events e where e.id=target_event_id and e.owner_user_id=auth.uid()) then
    raise exception 'only the Meeting creator may send an initial invitation' using errcode = '42501';
  end if;
  update public.events set initial_notification_requested_at = now()
    where id = target_event_id and initial_notification_requested_at is null
    returning * into event_row;
  if not found then return 0; end if;
  payload := jsonb_build_object('entity', 'meeting', 'id', event_row.id, 'title', event_row.title,
    'description', event_row.description, 'start_datetime', event_row.start_datetime,
    'end_datetime', event_row.end_datetime, 'location', event_row.location, 'status', event_row.status);
  select email into owner_email from public.profiles where id = event_row.owner_user_id;
  perform public.queue_notification(event_row.id, null, 'owner', owner_email, 'meeting_created', payload);
  notification_count := 1;
  for guest_row in select email from public.event_guests
    where event_id = event_row.id and occurrence_id is null and revoked_at is null loop
    perform public.queue_notification(event_row.id, null, 'guest', guest_row.email, 'meeting_guest_added', payload);
    notification_count := notification_count + 1;
  end loop;
  return notification_count;
end;
$$;

create or replace function public.queue_meeting_mobile_notification(target_event_id uuid, target_initial boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare meeting public.events; queued integer; template text; version_key text;
begin
  if not public.can_manage_event(target_event_id) then
    raise exception 'only the active Meeting creator may notify their devices' using errcode='42501';
  end if;
  if target_initial and not exists(select 1 from public.events e where e.id=target_event_id and e.owner_user_id=auth.uid()) then
    raise exception 'only the actual Meeting creator may send initial mobile notifications' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id and deleted_at is null and status='scheduled';
  if not found or not meeting.mobile_notifications_enabled then return 0; end if;
  template := case when target_initial then 'meeting_created' else 'meeting_updated' end;
  version_key := case when target_initial then 'initial' else meeting.notification_requested_at::text end;
  if version_key is null then return 0; end if;

  with recipients as (
    select meeting.owner_user_id as user_id
    union
    select guest.user_id from public.meeting_mobile_guest_users(meeting.id, null::uuid) guest
  )
  insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload)
  select meeting.id,case when recipient.user_id=meeting.owner_user_id then 'owner' else 'registered_user' end,
    device.id::text,'push',
    concat('meeting-mobile:',meeting.id,':',template,':',version_key,':',device.id),now(),template,
    jsonb_build_object('entity','meeting','id',meeting.id,'title',meeting.title,
      'description',meeting.description,'start_datetime',meeting.start_datetime,
      'end_datetime',meeting.end_datetime,'location',meeting.location,'push_user_id',recipient.user_id)
  from recipients recipient
  join public.profiles profile on profile.id=recipient.user_id and profile.status='active'
  join public.mobile_push_subscriptions device on device.user_id=recipient.user_id and device.endpoint like 'https://%'
  on conflict(idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

notify pgrst,'reload schema';
commit;
