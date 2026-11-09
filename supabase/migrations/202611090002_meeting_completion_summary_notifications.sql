begin;

-- A separate record avoids changing Meeting/occurrence lifecycle statuses.
-- Non-recurring Meetings use their start_datetime as occurrence_key; recurring
-- Meetings use the stable event_occurrences.occurrence_key.
create table public.meeting_completions (
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_key timestamptz not null,
  summary_html text not null default '',
  completed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(event_id, occurrence_key)
);
alter table public.meeting_completions enable row level security;
revoke all on public.meeting_completions from public,anon,authenticated;
grant select on public.meeting_completions to authenticated,service_role;
create policy meeting_completion_read on public.meeting_completions for select to authenticated
  using (public.can_read_event(event_id));

-- Retain this deployment cutoff forever; old locally completed Meetings cannot
-- be reliably inferred by the server and must not be mass-notified.
create table public.meeting_completion_notification_settings (
  singleton boolean primary key default true check(singleton),
  eligible_from timestamptz not null
);
revoke all on public.meeting_completion_notification_settings from public,anon,authenticated;
insert into public.meeting_completion_notification_settings(singleton,eligible_from) values(true,clock_timestamp());

create or replace function public.save_meeting_completion(
  target_event_id uuid, target_occurrence_start timestamptz,
  target_summary_html text, target_completed boolean
) returns public.meeting_completions language plpgsql security definer set search_path='' as $$
declare
  meeting public.events%rowtype; appointment public.event_occurrences%rowtype;
  canonical_key timestamptz; actual_start timestamptz; clean_html text;
  stripped text; visible_text text; result public.meeting_completions%rowtype; matching integer;
begin
  if auth.uid() is null or not public.is_active_user() or target_event_id is null
    or target_occurrence_start is null or target_completed is null
    or not public.can_manage_event(target_event_id) then
    raise exception 'only an active Meeting owner or Admin may change completion' using errcode='42501';
  end if;
  select * into meeting from public.events where id=target_event_id for update;
  if not found or meeting.status<>'scheduled' or meeting.deleted_at is not null then
    raise exception 'Meeting is unavailable' using errcode='P0002';
  end if;
  if meeting.recurrence_rule is null then
    if meeting.start_datetime<>target_occurrence_start then raise exception 'appointment not found' using errcode='22023'; end if;
    canonical_key:=meeting.start_datetime; actual_start:=meeting.start_datetime;
  else
    select * into appointment from public.event_occurrences
      where event_id=meeting.id and occurrence_key=target_occurrence_start for update;
    if not found then
      select count(*) into matching from public.event_occurrences
        where event_id=meeting.id and start_datetime=target_occurrence_start;
      if matching<>1 then raise exception 'appointment not found or ambiguous' using errcode='22023'; end if;
      select * into appointment from public.event_occurrences
        where event_id=meeting.id and start_datetime=target_occurrence_start for update;
    end if;
    if appointment.status<>'scheduled' then raise exception 'appointment is unavailable' using errcode='22023'; end if;
    canonical_key:=appointment.occurrence_key; actual_start:=appointment.start_datetime;
  end if;
  if target_completed and (case when meeting.all_day
      then (actual_start at time zone 'Asia/Bangkok')::date > (now() at time zone 'Asia/Bangkok')::date
      else actual_start>now() end) then
    raise exception 'Meeting has not started' using errcode='22023';
  end if;
  select * into result from public.meeting_completions where event_id=meeting.id and occurrence_key=canonical_key for update;
  clean_html:=coalesce(target_summary_html, result.summary_html, '');
  if length(clean_html)>30000 then raise exception 'Meeting summary is too long' using errcode='22023'; end if;
  -- Only a deliberately small set of formatting tags is accepted; no attrs,
  -- links, images, scripting or HTML comments. Text must be HTML-escaped.
  stripped:=regexp_replace(clean_html,'</?(p|br|strong|b|em|i|u|ul|ol|li)\s*/?>','','gi');
  if stripped ~ '[<>]' then raise exception 'unsupported Meeting summary markup' using errcode='22023'; end if;
  visible_text:=regexp_replace(stripped,'(&nbsp;|&#0*160;|&#x0*a0;|[[:space:]]|​| )','','gi');
  if target_completed and visible_text='' then raise exception 'Meeting summary is required' using errcode='22023'; end if;
  insert into public.meeting_completions(event_id,occurrence_key,summary_html,completed_at,updated_by)
    values(meeting.id,canonical_key,clean_html,case when target_completed then now() else null end,auth.uid())
    on conflict(event_id,occurrence_key) do update set summary_html=excluded.summary_html,
      completed_at=case when target_completed then coalesce(public.meeting_completions.completed_at,now()) else null end,
      updated_by=auth.uid(),updated_at=now()
    returning * into result;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),case when target_completed then 'MEETING_COMPLETED' else 'MEETING_REOPENED' end,
      'event',meeting.id::text,jsonb_build_object('occurrence_key',canonical_key));
  return result;
end;
$$;
revoke all on function public.save_meeting_completion(uuid,timestamptz,text,boolean) from public,anon;
grant execute on function public.save_meeting_completion(uuid,timestamptz,text,boolean) to authenticated;

-- Queue once per appointment and channel/device. A send-time recheck in the
-- worker is required because completion, cancellation or deletion may race.
create or replace function public.queue_due_meeting_completion_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare queued integer:=0; inserted integer; cutoff timestamptz;
begin
  select eligible_from into cutoff from public.meeting_completion_notification_settings where singleton;
  if cutoff is null then return 0; end if;
  with candidates as (
    select e.id as event_id,e.owner_user_id,e.title,e.description,e.location,e.all_day,
      e.email_notifications_enabled,e.mobile_notifications_enabled,
      o.id as occurrence_id,o.occurrence_key,o.start_datetime,o.end_datetime,
      coalesce(o.override_payload->>'description',e.description) as effective_description,
      coalesce(o.override_payload->>'location',e.location) as effective_location
    from public.events e join public.event_occurrences o on o.event_id=e.id
    where e.recurrence_rule is not null and e.status='scheduled' and e.deleted_at is null and o.status='scheduled'
    union all
    select e.id,e.owner_user_id,e.title,e.description,e.location,e.all_day,
      e.email_notifications_enabled,e.mobile_notifications_enabled,
      null::uuid,e.start_datetime,e.start_datetime,e.end_datetime,e.description,e.location
    from public.events e where e.recurrence_rule is null and e.status='scheduled' and e.deleted_at is null
  ), due as (
    select c.*,case when c.all_day then greatest(coalesce(c.end_datetime,c.start_datetime),
       (((c.start_datetime at time zone 'Asia/Bangkok')::date+1)::timestamp at time zone 'Asia/Bangkok'))
      else coalesce(c.end_datetime,c.start_datetime) end as due_at
    from candidates c
  ), eligible as (
    select d.*, p.email from due d join public.profiles p on p.id=d.owner_user_id and p.status='active'
    where d.due_at>=cutoff and d.due_at<=now() and not exists(select 1 from public.meeting_completions m
      where m.event_id=d.event_id and m.occurrence_key=d.occurrence_key and m.completed_at is not null)
  ), recipient_rows as (
    select e.*, 'email'::text as channel, lower(btrim(e.email)) as recipient_reference
      from eligible e where e.email_notifications_enabled and nullif(btrim(e.email),'') is not null
    union all
    select e.*, 'push'::text, device.id::text from eligible e
      join public.mobile_push_subscriptions device on device.user_id=e.owner_user_id and device.endpoint like 'https://%'
      where e.mobile_notifications_enabled
  )
  insert into public.notification_deliveries(event_id,recipient_type,recipient_reference,channel,idempotency_key,scheduled_at,template_key,payload)
    select event_id,'owner',recipient_reference,channel,
      concat('meeting-completion:',event_id,':',to_char(occurrence_key at time zone 'UTC','YYYYMMDDHH24MISS.US'),':',channel,':',recipient_reference),
      due_at,'meeting_completion_reminder',jsonb_build_object('entity','meeting','id',event_id,
        'occurrence_key',occurrence_key,'occurrence_start',start_datetime,'occurrence_id',occurrence_id,
        'title',title,'description',effective_description,'location',effective_location,
        'start_datetime',start_datetime,'end_datetime',end_datetime,'all_day',all_day)
        ||case when channel='push' then jsonb_build_object('push_user_id',owner_user_id) else '{}'::jsonb end
    from recipient_rows on conflict(idempotency_key) do nothing;
  get diagnostics inserted=row_count; queued:=queued+inserted;
  return queued;
end;
$$;
revoke all on function public.queue_due_meeting_completion_reminders() from public,anon,authenticated;
grant execute on function public.queue_due_meeting_completion_reminders() to service_role;
notify pgrst,'reload schema';
commit;
