begin;
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
    -- Membership-scope RPCs execute as their function owner. Only permit an
    -- active Admin's own verified guest row and only the three scope fields;
    -- direct authenticated table updates retain the existing restrictions.
    if tg_table_name='event_guests' and current_user=pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc
      where oid='public.change_meeting_attendance_to_occurrence(uuid,timestamptz)'::regprocedure)) then
      if before_row->>'occurrence_id' is null
        and (before_row-array['self_join_from','self_join_until','attendance_history'])
          = (after_row-array['self_join_from','self_join_until','attendance_history'])
        and exists(select 1 from public.profiles p join auth.users u on u.id=p.id
          where p.id=auth.uid() and p.status='active' and p.email_verified_at is not null
            and u.email_confirmed_at is not null and lower(btrim(u.email))=lower(btrim(p.email))
            and lower(btrim(p.email))=lower(btrim(before_row->>'email')))
      then return new; end if;
    end if;
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
notify pgrst, 'reload schema';
commit;
