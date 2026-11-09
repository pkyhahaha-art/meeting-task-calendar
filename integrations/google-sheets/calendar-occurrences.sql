begin;
-- Requires the existing four-argument Sheets importer installed in this project.
create or replace function public.sync_google_calendar_occurrences(
  payload jsonb, sync_start timestamptz, sync_end timestamptz, active_emails text[], preview boolean
) returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $fn$
declare
  adopted integer;
  result jsonb;
  upsert_payload jsonb;
  deleted integer;
  month_start timestamptz;
begin
  month_start := date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  if preview is null or jsonb_typeof(payload) is distinct from 'array'
    or sync_start is distinct from month_start
    or sync_end is distinct from ((month_start at time zone 'Asia/Bangkok' + interval '1 month') at time zone 'Asia/Bangkok')
    or coalesce(cardinality(active_emails), 0) = 0
    or exists (select 1 from unnest(active_emails) owner where owner is null or btrim(owner) = '')
  then
    raise exception 'Invalid or stale calendar sync scope' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(payload) item
    where coalesce(item->>'google_event_id', '') not like 'gcal-v2:%'
      or not coalesce((item->>'calendar_owner_email') = any(active_emails), false)
      or not coalesce((item->>'start_time')::timestamptz >= sync_start
        and (item->>'start_time')::timestamptz < sync_end, false)
  ) or exists (
    select 1 from jsonb_array_elements(payload) item
    group by item->>'google_event_id' having count(*) > 1
  ) then
    raise exception 'Invalid or duplicate calendar snapshot rows' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('google-calendar-snapshot', 0));
  begin
    -- Keep the original PEA row when the old ID, owner and appointment time
    -- identify exactly one instance. Prior imports may have stored Thai local
    -- times as UTC, so prefer an exact instant before the known seven-hour offset.
    with candidates as (
      select e.id, item->>'google_event_id' as target_key,
        case when e.start_datetime = (item->>'start_time')::timestamptz then 0 else 1 end as priority
      from public.events e
      join jsonb_array_elements(payload) item on e.google_event_id = item->>'legacy_google_event_id'
        and e.calendar_owner_email = item->>'calendar_owner_email'
      where e.google_event_id not like 'gcal-v2:%'
        and e.start_datetime in ((item->>'start_time')::timestamptz, (item->>'start_time')::timestamptz + interval '7 hours')
        and not exists (select 1 from public.events current_row where current_row.google_event_id = item->>'google_event_id')
    ), ranked as (
      select *, rank() over (partition by id order by priority) as preference,
        count(*) over (partition by id, priority) as ties
      from candidates
    )
    update public.events e set google_event_id = ranked.target_key
    from ranked where ranked.id = e.id and ranked.preference = 1 and ranked.ties = 1;
    get diagnostics adopted = row_count;

    if exists (
      select 1 from public.events e
      join jsonb_array_elements(payload) item on e.google_event_id = item->>'legacy_google_event_id'
        and e.calendar_owner_email = item->>'calendar_owner_email'
      where e.deleted_at is null and e.status = 'scheduled'
        and e.start_datetime >= sync_start and e.start_datetime < sync_end
    ) then
      raise exception 'Could not safely match an existing Google appointment' using errcode = 'ZC002';
    end if;

    -- Never reactivate a locally cancelled meeting. Changing its status could
    -- also trigger the app's normal update notifications.
    perform 1 from public.events e
    where exists (select 1 from jsonb_array_elements(payload) item where item->>'google_event_id' = e.google_event_id)
    order by e.id for update;
    select coalesce(jsonb_agg(item), '[]'::jsonb) into upsert_payload
    from jsonb_array_elements(payload) item
    where not exists (select 1 from public.events e where e.google_event_id = item->>'google_event_id' and e.status = 'cancelled');
    result := public.sync_google_calendar_events(upsert_payload, null, null, null);

    update public.events e set deleted_at = now(), updated_at = now()
    where e.google_event_id is not null and e.calendar_owner_email = any(active_emails)
      and e.start_datetime >= sync_start and e.start_datetime < sync_end
      and e.deleted_at is null and e.status = 'scheduled'
      and not exists (select 1 from jsonb_array_elements(payload) item where item->>'google_event_id' = e.google_event_id);
    get diagnostics deleted = row_count;
    result := result || jsonb_build_object('adopted', adopted, 'deleted', deleted,
      'kept_cancelled', jsonb_array_length(payload) - jsonb_array_length(upsert_payload), 'preview', preview);
    if preview then
      raise exception 'Rollback calendar preview' using errcode = 'ZC001';
    end if;
  exception when sqlstate 'ZC001' then
    return result;
  end;
  return result;
end;
$fn$;
revoke all on function public.sync_google_calendar_occurrences(jsonb,timestamptz,timestamptz,text[],boolean)
  from public, anon, authenticated;
grant execute on function public.sync_google_calendar_occurrences(jsonb,timestamptz,timestamptz,text[],boolean)
  to service_role;
notify pgrst, 'reload schema';
commit;
