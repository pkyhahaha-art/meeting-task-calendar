begin;

-- Maintenance access is deliberately confined to these Admin RPCs. Ordinary
-- calendar editing policies, recipient access and retention are unchanged.
create function public.admin_calendar_items(
  target_entity text default '', target_creator_user_id uuid default null,
  target_search text default '', target_created_from timestamptz default null,
  target_created_to timestamptz default null, target_offset integer default 0,
  target_limit integer default 25
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; search_text text:=btrim(coalesce(target_search,''));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'active Admin account required' using errcode='42501';
  end if;
  if target_entity is null or target_entity not in ('','task','meeting')
    or target_offset is null or target_offset<0 or target_limit is null or target_limit not between 1 and 100
    or char_length(search_text)>200
    or (target_created_from is not null and target_created_to is not null and target_created_from>=target_created_to) then
    raise exception 'invalid calendar filters' using errcode='22023';
  end if;
  with items as (
    select 'task'::text entity,t.id,t.title,t.creator_user_id,
      coalesce(nullif(t.creator_name,''),p.full_name) creator_name,p.email creator_email,
      t.created_at,null::timestamptz start_datetime,null::timestamptz end_datetime,
      t.due_date,t.due_time,t.status,t.recurrence_rule is not null recurring,t.affiliation
    from public.tasks t join public.profiles p on p.id=t.creator_user_id where t.deleted_at is null
    union all
    select 'meeting',e.id,e.title,e.owner_user_id,
      coalesce(nullif(e.creator_name,''),p.full_name),p.email,e.created_at,e.start_datetime,e.end_datetime,
      null::date,null::time,e.status,e.recurrence_rule is not null,e.affiliation
    from public.events e join public.profiles p on p.id=e.owner_user_id where e.deleted_at is null
  ), filtered as materialized (
    select * from items i where (target_entity='' or i.entity=target_entity)
      and (target_creator_user_id is null or i.creator_user_id=target_creator_user_id)
      and (target_created_from is null or i.created_at>=target_created_from)
      and (target_created_to is null or i.created_at<target_created_to)
      and (search_text='' or strpos(lower(concat_ws(' ',i.id,i.title,i.affiliation,i.creator_name,i.creator_email)),lower(search_text))>0)
  ), page as (
    select * from filtered order by created_at desc,entity,id offset target_offset limit target_limit
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,entity,id) from page),'[]'::jsonb),
    'total_count',(select count(*) from filtered)) into result;
  return result;
end;
$$;

create function public.admin_meeting_occurrences(target_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'active Admin account required' using errcode='42501';
  end if;
  if not exists(select 1 from public.events e where e.id=target_event_id and e.deleted_at is null
    and e.status='scheduled' and e.recurrence_rule is not null) then
    raise exception 'a scheduled recurring Meeting is required' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'occurrence_key',o.occurrence_key,
    'start_datetime',o.start_datetime,'end_datetime',o.end_datetime) order by o.start_datetime,o.id)
    from public.event_occurrences o where o.event_id=target_event_id and o.status='scheduled'),'[]'::jsonb);
end;
$$;

create function public.admin_trash_calendar_items(target_items jsonb,target_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare task_ids uuid[]; event_ids uuid[]; affected_task_ids uuid[]; item record;
  affected integer:=0; reason text:=btrim(coalesce(target_reason,''));
  previous_context text:=current_setting('app.admin_calendar_trash',true);
  previous_materialization text:=current_setting('app.materializing_task_series',true);
begin
  -- Lock the actor's active Admin profile so disabling it cannot race the write.
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active' for share;
  if auth.uid() is null or not found then
    raise exception 'active Admin account required' using errcode='42501';
  end if;
  if char_length(reason) not between 1 and 500 or target_items is null or jsonb_typeof(target_items)<>'array' then
    raise exception 'calendar items and a reason are required' using errcode='22023';
  end if;
  if jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'select between 1 and 100 calendar items' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(target_items) value where jsonb_typeof(value)<>'object'
    or coalesce(value->>'entity','') not in ('task','meeting')
    or jsonb_typeof(value->'id') is distinct from 'string'
    or coalesce(value->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'invalid calendar item' using errcode='22023';
  end if;
  select coalesce(array_agg(distinct (value->>'id')::uuid) filter(where value->>'entity'='task'),'{}'::uuid[]),
    coalesce(array_agg(distinct (value->>'id')::uuid) filter(where value->>'entity'='meeting'),'{}'::uuid[])
    into task_ids,event_ids from jsonb_array_elements(target_items) value;

  -- Validate the complete selection before mutation. Missing or already trashed
  -- rows fail the transaction, rather than silently deleting only part of it.
  perform 1 from public.tasks where id=any(task_ids) order by id for update;
  perform 1 from public.events where id=any(event_ids) order by id for update;
  if (select count(*) from public.tasks where id=any(task_ids) and deleted_at is null)<>cardinality(task_ids)
    or (select count(*) from public.events where id=any(event_ids) and deleted_at is null)<>cardinality(event_ids) then
    raise exception 'a selected calendar item is missing or already in Trash' using errcode='22023';
  end if;
  -- Preserve the pre-existing legacy Task series cascade and stop its pending
  -- jobs too. New Tasks no longer create recurrence children.
  select coalesce(array_agg(distinct t.id),'{}'::uuid[]) into affected_task_ids from public.tasks t
    where t.id=any(task_ids) or (t.recurrence_series_id=any(task_ids) and t.status='pending' and t.due_date>=current_date
      and exists(select 1 from public.tasks root where root.id=t.recurrence_series_id and root.recurrence_rule is not null));
  -- Stop existing jobs first. Task status triggers may then enqueue the same
  -- cancellation confirmation as a creator's ordinary deletion.
  update public.task_reminders set status='cancelled' where task_id=any(affected_task_ids)
    and status in ('scheduled','processing','deferred_quota');
  update public.reminders set status='cancelled' where event_id=any(event_ids) and status in ('scheduled','processing');
  update public.notification_deliveries set status='skipped',next_attempt_at=null,
    error_code='admin_calendar_trashed',error_message='Calendar item was moved to Trash by an Admin'
    where (task_id=any(affected_task_ids) or event_id=any(event_ids))
      and status in ('queued','retry','deferred_quota','processing');
  perform set_config('app.admin_calendar_trash',auth.uid()::text,true);
  for item in select t.id,t.title,t.creator_user_id from public.tasks t where t.id=any(task_ids) order by t.id loop
    update public.tasks set status='cancelled',deleted_at=now() where id=item.id;
    -- A legacy child-cancellation trigger sets this flag; do not let it suppress
    -- ordinary confirmations for later explicitly selected Tasks in the batch.
    perform set_config('app.materializing_task_series',coalesce(previous_materialization,''),true);
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
      values(auth.uid(),'ADMIN_TASK_TRASHED','task',item.id::text,
        jsonb_build_object('title',item.title,'creator_user_id',item.creator_user_id,'reason',reason));
    affected:=affected+1;
  end loop;
  perform set_config('app.admin_calendar_trash',coalesce(previous_context,''),true);
  for item in select e.id,e.title,e.owner_user_id,e.recurrence_rule from public.events e where e.id=any(event_ids) order by e.id loop
    update public.events set deleted_at=now() where id=item.id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
      values(auth.uid(),'ADMIN_MEETING_TRASHED','event',item.id::text,
        jsonb_build_object('title',item.title,'creator_user_id',item.owner_user_id,'reason',reason,'whole_series',item.recurrence_rule is not null));
    affected:=affected+1;
  end loop;
  return affected;
end;
$$;

-- The Task creator guard remains the default. An exception is accepted only
-- while the narrowly authorized trash RPC runs as its trusted function owner,
-- and only for the exact soft-trash fields. Client-set flags cannot bypass RLS
-- or this effective-role/active-Admin check.
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
    raise exception 'only the Task creator may change or complete this Task' using errcode='42501';
  end if;
  return new;
end;
$$;

create function public.admin_cancel_meeting_occurrence(
  target_event_id uuid,target_occurrence_start timestamptz,target_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; appointment public.event_occurrences; reason text:=btrim(coalesce(target_reason,''));
begin
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active' for share;
  if auth.uid() is null or not found then
    raise exception 'active Admin account required' using errcode='42501';
  end if;
  if char_length(reason) not between 1 and 500 then raise exception 'a reason is required' using errcode='22023'; end if;
  select * into meeting from public.events where id=target_event_id for update;
  if not found or meeting.recurrence_rule is null or meeting.status<>'scheduled' or meeting.deleted_at is not null then
    raise exception 'a scheduled recurring Meeting is required' using errcode='22023';
  end if;
  select * into appointment from public.event_occurrences where event_id=meeting.id and occurrence_key=target_occurrence_start for update;
  if not found or appointment.start_datetime<=now() then raise exception 'a future appointment is required' using errcode='22023'; end if;
  if appointment.status='cancelled' then return appointment.id; end if;
  if appointment.status<>'scheduled' then raise exception 'a scheduled appointment is required' using errcode='22023'; end if;
  update public.event_occurrences set status='cancelled',
    override_payload=(override_payload-'recurrence_removed')||'{"cancelled_individually":true}'::jsonb where id=appointment.id;
  update public.notification_deliveries d set status='skipped',next_attempt_at=null,error_code='appointment_cancelled',
    error_message='This appointment was cancelled individually by an Admin'
    where d.event_id=meeting.id and d.status in ('queued','retry','deferred_quota','processing')
      and (d.payload->>'occurrence_id'=appointment.id::text or d.reminder_id in (
        select r.id from public.reminders r where r.event_id=meeting.id and (r.occurrence_id=appointment.id
          or (r.occurrence_id is null and appointment.occurrence_key=meeting.start_datetime))));
  update public.reminders set status='cancelled' where event_id=meeting.id
    and (occurrence_id=appointment.id or (occurrence_id is null and appointment.occurrence_key=meeting.start_datetime))
    and status in ('scheduled','processing');
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'ADMIN_MEETING_OCCURRENCE_CANCELLED','event_occurrence',appointment.id::text,
      jsonb_build_object('event_id',meeting.id,'title',meeting.title,'creator_user_id',meeting.owner_user_id,
        'start_datetime',appointment.start_datetime,'reason',reason));
  perform public.queue_meeting_occurrence_action(meeting.id,appointment.id,appointment.start_datetime,null,meeting.id,appointment.id);
  return appointment.id;
end;
$$;

revoke all on function public.admin_calendar_items(text,uuid,text,timestamptz,timestamptz,integer,integer) from public,anon;
revoke all on function public.admin_meeting_occurrences(uuid) from public,anon;
revoke all on function public.admin_trash_calendar_items(jsonb,text) from public,anon;
revoke all on function public.admin_cancel_meeting_occurrence(uuid,timestamptz,text) from public,anon;
grant execute on function public.admin_calendar_items(text,uuid,text,timestamptz,timestamptz,integer,integer) to authenticated;
grant execute on function public.admin_meeting_occurrences(uuid) to authenticated;
grant execute on function public.admin_trash_calendar_items(jsonb,text) to authenticated;
grant execute on function public.admin_cancel_meeting_occurrence(uuid,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
commit;
