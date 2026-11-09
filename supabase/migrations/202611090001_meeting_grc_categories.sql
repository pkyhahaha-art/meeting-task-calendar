begin;
alter table public.events add column if not exists grc_category_key text;
alter table public.events add column if not exists committee_key text;
alter table public.events add constraint events_grc_category_key_check check (grc_category_key is null or grc_category_key in ('S001','S002','S003','S004','S005','S099'));
alter table public.events add constraint events_committee_key_check check (committee_key is null or committee_key in ('C001','C002','C003','C004','C005','C006','C007','C099'));
create index if not exists events_grc_category_key_idx on public.events(grc_category_key) where grc_category_key is not null;
create index if not exists events_committee_key_idx on public.events(committee_key) where committee_key is not null;

-- Regular direct API inserts follow the same required fields as the form.
-- Trusted definer paths (such as detaching a legacy occurrence) retain their
-- existing behavior and are checked in their own entry points.
create or replace function public.require_new_meeting_categories()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' and auth.uid() is not null
    and (new.grc_category_key is null or new.committee_key is null) then
    raise exception 'both Meeting categories are required' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.require_new_meeting_categories() from public,anon,authenticated;
create trigger require_new_meeting_categories before insert on public.events
  for each row execute function public.require_new_meeting_categories();

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
  if meeting.id is null and (values_row.grc_category_key is null or values_row.committee_key is null) then
    raise exception 'both Meeting categories are required' using errcode='22023';
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
    'mobile_notifications_enabled',values_row.mobile_notifications_enabled,
    'grc_category_key',case when target_event ? 'grc_category_key' then values_row.grc_category_key else meeting.grc_category_key end,
    'committee_key',case when target_event ? 'committee_key' then values_row.committee_key else meeting.committee_key end) then
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
      recurrence_rule,recurrence_until,recurrence_count,email_notifications_enabled,mobile_notifications_enabled,suppress_guest_notifications,grc_category_key,committee_key)
      values(target_event_id,auth.uid(),values_row.title,coalesce(values_row.description,''),coalesce(values_row.location,''),
        coalesce(values_row.affiliation,''),values_row.all_day,values_row.start_datetime,values_row.end_datetime,
        values_row.recurrence_rule,values_row.recurrence_until,values_row.recurrence_count,
        values_row.email_notifications_enabled,values_row.mobile_notifications_enabled,true,values_row.grc_category_key,values_row.committee_key);
  else
    update public.events set title=values_row.title,description=coalesce(values_row.description,''),
      location=coalesce(values_row.location,''),affiliation=coalesce(values_row.affiliation,''),all_day=values_row.all_day,
      start_datetime=values_row.start_datetime,end_datetime=values_row.end_datetime,recurrence_rule=values_row.recurrence_rule,
      recurrence_until=values_row.recurrence_until,recurrence_count=values_row.recurrence_count,
      email_notifications_enabled=values_row.email_notifications_enabled,mobile_notifications_enabled=values_row.mobile_notifications_enabled,
      grc_category_key=case when target_event ? 'grc_category_key' then values_row.grc_category_key else meeting.grc_category_key end,
      committee_key=case when target_event ? 'committee_key' then values_row.committee_key else meeting.committee_key end,
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
      'notification_requested_at','suppress_guest_notifications','updated_at','grc_category_key','committee_key'])
      is distinct from (to_jsonb(old)-array['title','description','location','affiliation','all_day','start_datetime','end_datetime',
      'recurrence_rule','recurrence_until','recurrence_count','email_notifications_enabled','mobile_notifications_enabled',
      'notification_requested_at','suppress_guest_notifications','updated_at','grc_category_key','committee_key']) then
    raise exception 'Admin edits cannot change Meeting identity, status or Trash state' using errcode='42501';
  end if;
  return new;
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
    all_day,timezone,suppress_guest_notifications,email_notifications_enabled,mobile_notifications_enabled,grc_category_key,committee_key)
  values(meeting.owner_user_id,meeting.title,btrim(coalesce(target_description,'')),btrim(coalesce(target_location,'')),
    meeting.affiliation,target_new_start,
    case when appointment.end_datetime is null then null else target_new_start+(appointment.end_datetime-appointment.start_datetime) end,
    meeting.all_day,meeting.timezone,true,meeting.email_notifications_enabled,meeting.mobile_notifications_enabled,meeting.grc_category_key,meeting.committee_key)
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
notify pgrst,'reload schema';
commit;
