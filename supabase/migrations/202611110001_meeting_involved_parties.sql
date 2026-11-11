begin;
-- Optional descriptive text. Existing meetings and older clients keep their data.
alter table public.events add column if not exists involved_parties text not null default '';

-- Modify the deployed RPC in place: keep its current authorization, reminder,
-- recurrence and notification behavior. Fail closed if its body has drifted.
do $migration$
declare original text; revised text;
begin
  select pg_get_functiondef('public.save_meeting_event_v3(uuid,jsonb,text[],jsonb,boolean)'::regprocedure) into original;
  revised := replace(original,
    $old$'affiliation',coalesce(values_row.affiliation,''),'all_day'$old$,
    $new$'affiliation',coalesce(values_row.affiliation,''),'involved_parties',case when target_event ? 'involved_parties' then coalesce(values_row.involved_parties,'') else meeting.involved_parties end,'all_day'$new$);
  revised := replace(revised,
    $old$location,affiliation,all_day,start_datetime$old$,
    $new$location,affiliation,involved_parties,all_day,start_datetime$new$);
  revised := replace(revised,
    $old$coalesce(values_row.affiliation,''),values_row.all_day$old$,
    $new$coalesce(values_row.affiliation,''),coalesce(values_row.involved_parties,''),values_row.all_day$new$);
  revised := replace(revised,
    $old$affiliation=coalesce(values_row.affiliation,''),all_day=values_row.all_day$old$,
    $new$affiliation=coalesce(values_row.affiliation,''),involved_parties=case when target_event ? 'involved_parties' then coalesce(values_row.involved_parties,'') else meeting.involved_parties end,all_day=values_row.all_day$new$);
  if revised = original or position('involved_parties=case when target_event' in revised)=0
    or position('location,affiliation,involved_parties,all_day,start_datetime' in revised)=0
    or position($check$coalesce(values_row.affiliation,''),coalesce(values_row.involved_parties,''),values_row.all_day$check$ in revised)=0
    or position('''involved_parties'',case when target_event' in revised)=0 then
    raise exception 'Meeting save RPC does not match expected deployed version';
  end if;
  execute revised;
end $migration$;

-- Admins may edit the same new field as the owner, without changing identity.
do $migration$
declare original text; revised text;
begin
  select pg_get_functiondef('public.guard_admin_event_edit()'::regprocedure) into original;
  revised := replace(original, $old$'location','affiliation','all_day'$old$, $new$'location','affiliation','involved_parties','all_day'$new$);
  if revised = original then raise exception 'Admin Meeting guard does not match expected deployed version'; end if;
  execute revised;
end $migration$;
-- Moving one recurring appointment creates a standalone meeting; copy its text.
do $migration$
declare original text; revised text;
begin
  select pg_get_functiondef('public.detach_meeting_occurrence(uuid,timestamptz,timestamptz,text,text,text[])'::regprocedure) into original;
  revised := replace(original, $old$location,affiliation,start_datetime,end_datetime$old$, $new$location,affiliation,involved_parties,start_datetime,end_datetime$new$);
  revised := replace(revised, $old$meeting.affiliation,target_new_start$old$, $new$meeting.affiliation,meeting.involved_parties,target_new_start$new$);
  if revised = original or position('meeting.affiliation,meeting.involved_parties,target_new_start' in revised)=0
    or position('location,affiliation,involved_parties,start_datetime,end_datetime' in revised)=0 then
    raise exception 'Move occurrence RPC does not match expected deployed version';
  end if;
  execute revised;
end $migration$;
commit;
