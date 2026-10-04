-- Atomic counterpart of the existing meeting form save. Existing tables,
-- recipient rules and notification RPCs remain unchanged.
begin;
-- Read-only service access for current-recipient verification in Edge Functions.
-- No new client privileges are granted.
grant select on public.task_internal_recipients to service_role;
grant execute on function public.occurrence_guest_emails(uuid,uuid) to service_role;
create or replace function public.save_meeting_event_v3(
  target_event_id uuid, target_event jsonb, target_guest_emails text[],
  target_reminders jsonb, target_new boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare meeting public.events; values_row public.events; desired_emails text[];
  existing_emails text[]; incoming_reminders jsonb; existing_reminders jsonb;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'active employee account required' using errcode='42501';
  end if;
  if target_event_id is null or jsonb_typeof(target_event)<>'object'
    or target_event is null or jsonb_typeof(target_reminders)<>'array' or target_reminders is null then
    raise exception 'invalid Meeting save arguments' using errcode='22023';
  end if;
  -- Serialize both first-create and replay for a client-generated existing PK.
  perform pg_advisory_xact_lock(hashtextextended(target_event_id::text,0));
  select * into meeting from public.events where id=target_event_id for update;
  if found then
    if not public.can_manage_event(target_event_id) or (target_new and meeting.owner_user_id<>auth.uid())
      or meeting.deleted_at is not null or meeting.status<>'scheduled' then
      raise exception 'only the active owner or Admin may save this Meeting' using errcode='42501';
    end if;
  elsif not target_new then
    raise exception 'Meeting not found' using errcode='P0002';
  end if;
  values_row:=jsonb_populate_record(null::public.events,target_event);
  if values_row.start_datetime is null or values_row.title is null
    or values_row.all_day is null or values_row.email_notifications_enabled is null
    or values_row.mobile_notifications_enabled is null then
    raise exception 'missing Meeting fields' using errcode='22023';
  end if;
  if values_row.recurrence_rule is null and (values_row.recurrence_until is not null or values_row.recurrence_count is not null) then
    raise exception 'a recurrence end requires a recurrence rule';
  end if;
  if values_row.recurrence_until<values_row.start_datetime then raise exception 'recurrence end cannot be before the Meeting start'; end if;
  select coalesce(array_agg(email order by email),'{}'::text[]) into desired_emails from (
    select distinct lower(btrim(value)) email from unnest(coalesce(target_guest_emails,'{}'::text[])) value where btrim(value)<>''
  ) normalized;
  if exists(select 1 from unnest(desired_emails) email where email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') then
    raise exception 'invalid attendee email' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(target_reminders) as r(
    offset_value integer,offset_unit text,scheduled_at timestamptz,channel_email boolean,channel_line boolean,status text)
    where r.offset_value is null or r.offset_value<0 or r.offset_unit is null
      or r.offset_unit not in ('minute','hour','day','week','month') or r.scheduled_at is null
      or r.channel_email is null or r.channel_line is null or r.status is null or r.status not in ('scheduled','cancelled')) then
    raise exception 'invalid reminder template' using errcode='22023';
  end if;
  -- Identical retries must not regenerate completed reminders or confirmation
  -- messages. A changed draft still updates the same id, never a second Meeting.
  if target_new and meeting.id is not null and to_jsonb(meeting) @> jsonb_build_object(
    'title',values_row.title,'description',coalesce(values_row.description,''),'location',coalesce(values_row.location,''),
    'affiliation',coalesce(values_row.affiliation,''),'all_day',values_row.all_day,'start_datetime',values_row.start_datetime,
    'end_datetime',values_row.end_datetime,'recurrence_rule',values_row.recurrence_rule,'recurrence_until',values_row.recurrence_until,
    'recurrence_count',values_row.recurrence_count,'email_notifications_enabled',values_row.email_notifications_enabled,
    'mobile_notifications_enabled',values_row.mobile_notifications_enabled) then
    select coalesce(array_agg(lower(btrim(g.email)) order by lower(btrim(g.email))),'{}'::text[]) into existing_emails
      from public.event_guests g where g.event_id=meeting.id and g.occurrence_id is null and g.revoked_at is null;
    select coalesce(jsonb_agg(jsonb_build_object('offset_value',r.offset_value,'offset_unit',r.offset_unit,
      'scheduled_at',r.scheduled_at,'channel_email',r.channel_email,'channel_line',r.channel_line) order by r.offset_unit,r.offset_value),'[]'::jsonb)
      into existing_reminders from public.reminders r where r.event_id=meeting.id and r.occurrence_id is null;
    select coalesce(jsonb_agg(jsonb_build_object('offset_value',r.offset_value,'offset_unit',r.offset_unit,
      'scheduled_at',r.scheduled_at,'channel_email',r.channel_email,'channel_line',r.channel_line) order by r.offset_unit,r.offset_value),'[]'::jsonb)
      into incoming_reminders from jsonb_to_recordset(target_reminders) as r(offset_value integer,offset_unit text,
        scheduled_at timestamptz,channel_email boolean,channel_line boolean);
    if existing_emails=desired_emails and existing_reminders=incoming_reminders then return meeting.id; end if;
  end if;
  if meeting.id is null then
    insert into public.events(id,owner_user_id,title,description,location,affiliation,all_day,start_datetime,end_datetime,
      recurrence_rule,recurrence_until,recurrence_count,email_notifications_enabled,mobile_notifications_enabled,suppress_guest_notifications)
      values(target_event_id,auth.uid(),values_row.title,coalesce(values_row.description,''),coalesce(values_row.location,''),
        coalesce(values_row.affiliation,''),values_row.all_day,values_row.start_datetime,values_row.end_datetime,
        values_row.recurrence_rule,values_row.recurrence_until,values_row.recurrence_count,
        values_row.email_notifications_enabled,values_row.mobile_notifications_enabled,true);
  else
    update public.events set title=values_row.title,description=coalesce(values_row.description,''),
      location=coalesce(values_row.location,''),affiliation=coalesce(values_row.affiliation,''),all_day=values_row.all_day,
      start_datetime=values_row.start_datetime,end_datetime=values_row.end_datetime,recurrence_rule=values_row.recurrence_rule,
      recurrence_until=values_row.recurrence_until,recurrence_count=values_row.recurrence_count,
      email_notifications_enabled=values_row.email_notifications_enabled,mobile_notifications_enabled=values_row.mobile_notifications_enabled,
      suppress_guest_notifications=true where id=target_event_id;
  end if;
  delete from public.event_guests where event_id=target_event_id and occurrence_id is null and revoked_at is null
    and not(lower(btrim(email))=any(desired_emails));
  insert into public.event_guests(event_id,email)
    select target_event_id,email from unnest(desired_emails) email
    on conflict(event_id,email) where occurrence_id is null do update set revoked_at=null;
  -- Cancelling a replaced template must also cancel its queued deliveries before
  -- the existing FK detaches them; retain all delivery logs and occurrence data.
  update public.notification_deliveries d set status='skipped',next_attempt_at=null,
    error_code='reminder_cancelled',error_message='Reminder was replaced while saving the Meeting'
    from public.reminders r where r.event_id=target_event_id and d.reminder_id=r.id and d.status in ('queued','retry');
  delete from public.reminders where event_id=target_event_id;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line,status)
    select target_event_id,r.offset_value,r.offset_unit,r.scheduled_at,r.channel_email,r.channel_line,r.status
    from jsonb_to_recordset(target_reminders) as r(offset_value integer,offset_unit text,scheduled_at timestamptz,
      channel_email boolean,channel_line boolean,status text);
  perform public.refresh_meeting_occurrences(target_event_id);
  update public.events set suppress_guest_notifications=false where id=target_event_id;
  return target_event_id;
end;
$$;
revoke all on function public.save_meeting_event_v3(uuid,jsonb,text[],jsonb,boolean) from public,anon;
grant execute on function public.save_meeting_event_v3(uuid,jsonb,text[],jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
