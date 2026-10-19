-- Global soft-trash is a separate, explicitly confirmed Admin action.
-- Existing tables, retention, per-item Trash RPC and client write grants stay unchanged.
begin;

create function public.admin_calendar_trash_snapshot(target_task_ids uuid[] default null,target_event_ids uuid[] default null)
returns jsonb language sql stable security definer set search_path='' set timezone='UTC' as $$
  with items as (
    select 'task'::text entity,t.id,md5(to_jsonb(t)::text) content_hash
      from public.tasks t where t.deleted_at is null and (target_task_ids is null or t.id=any(target_task_ids))
    union all
    select 'meeting',e.id,md5(to_jsonb(e)::text)
      from public.events e where e.deleted_at is null and (target_event_ids is null or e.id=any(target_event_ids))
  )
  select jsonb_build_object('task_count',count(*) filter(where entity='task'),
    'meeting_count',count(*) filter(where entity='meeting'),'total_count',count(*),
    'snapshot','v1:'||md5(coalesce(string_agg(entity||':'||id::text||':'||content_hash,'|' order by entity,id),'')))
  from items;
$$;
revoke all on function public.admin_calendar_trash_snapshot(uuid[],uuid[]) from public,anon,authenticated;

create function public.admin_calendar_trash_preview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'active Admin account required' using errcode='42501';
  end if;
  return public.admin_calendar_trash_snapshot();
end;
$$;
revoke all on function public.admin_calendar_trash_preview() from public,anon;
grant execute on function public.admin_calendar_trash_preview() to authenticated;

create function public.admin_trash_all_calendar_items(target_snapshot text,target_reason text,target_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare task_ids uuid[]; event_ids uuid[]; snapshot jsonb; batch jsonb; affected integer;
  reason text:=btrim(coalesce(target_reason,''));
begin
  perform 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active' for share;
  if auth.uid() is null or not found then
    raise exception 'active Admin account required' using errcode='42501';
  end if;
  if target_confirmation is distinct from 'ลบทั้งหมด' or char_length(reason) not between 1 and 500
    or target_snapshot is null or target_snapshot !~ '^v1:[0-9a-f]{32}$' then
    raise exception 'a current preview, reason and exact confirmation are required' using errcode='22023';
  end if;
  -- This exceptional all-system action briefly serializes calendar writers.
  -- No concurrent insert can become an unreviewed legacy-series cascade target.
  -- Inserts waiting on this lock are created after commit and remain untouched.
  lock table public.tasks,public.events in share row exclusive mode;
  select coalesce(array_agg(id order by id) filter(where entity='task'),'{}'::uuid[]),
    coalesce(array_agg(id order by id) filter(where entity='meeting'),'{}'::uuid[])
    into task_ids,event_ids from (
      select 'task'::text entity,t.id from public.tasks t where t.deleted_at is null
      union all select 'meeting',e.id from public.events e where e.deleted_at is null
    ) candidates;
  perform 1 from public.tasks where id=any(task_ids) order by id for update;
  perform 1 from public.events where id=any(event_ids) order by id for update;
  snapshot:=public.admin_calendar_trash_snapshot(task_ids,event_ids);
  if snapshot->>'snapshot' is distinct from target_snapshot then
    raise exception 'Calendar items changed; load a new all-system preview before confirming' using errcode='40001';
  end if;
  loop
    -- Process captured leaves before a legacy parent that could implicitly
    -- cancel them. Each item therefore retains its ordinary per-item audit.
    -- Always take the first remaining captured ids: no offset skips as rows move.
    select jsonb_agg(jsonb_build_object('entity',entity,'id',id) order by entity,id) into batch from (
      select entity,id from (
        select 'task'::text entity,t.id from public.tasks t
          where t.id=any(task_ids) and t.deleted_at is null and not exists(
            select 1 from public.tasks child where child.id=any(task_ids) and child.deleted_at is null
              and child.recurrence_series_id=t.id and t.recurrence_rule is not null
              and child.status='pending' and child.due_date>=current_date)
        union all select 'meeting',e.id from public.events e where e.id=any(event_ids) and e.deleted_at is null
      ) remaining order by entity,id limit 100
    ) next_batch;
    exit when batch is null;
    affected:=public.admin_trash_calendar_items(batch,reason);
    if affected<>jsonb_array_length(batch) then
      raise exception 'All-system Trash did not process the complete batch' using errcode='40001';
    end if;
  end loop;
  if exists(select 1 from public.tasks where id=any(task_ids) and deleted_at is null)
    or exists(select 1 from public.events where id=any(event_ids) and deleted_at is null) then
    raise exception 'All-system Trash could not resolve every captured item' using errcode='40001';
  end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'ADMIN_ALL_CALENDAR_TRASHED','system',null,
      (snapshot-'snapshot')||jsonb_build_object('reason',reason,'scope','all_nontrashed'));
  return snapshot-'snapshot';
end;
$$;
revoke all on function public.admin_trash_all_calendar_items(text,text,text) from public,anon;
grant execute on function public.admin_trash_all_calendar_items(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
