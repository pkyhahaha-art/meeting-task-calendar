begin;

-- Extend admin_calendar_items RPC to return description and location
create or replace function public.admin_calendar_items(
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
    select 'task'::text entity, t.id, t.title, t.creator_user_id,
      coalesce(nullif(t.creator_name,''), p.full_name) creator_name, p.email creator_email,
      t.created_at, null::timestamptz start_datetime, null::timestamptz end_datetime,
      t.due_date, t.due_time, t.status, t.recurrence_rule is not null recurring, t.affiliation,
      t.description, null::text as location
    from public.tasks t join public.profiles p on p.id=t.creator_user_id where t.deleted_at is null
    union all
    select 'meeting', e.id, e.title, e.owner_user_id,
      coalesce(nullif(e.creator_name,''), p.full_name), p.email, e.created_at, e.start_datetime, e.end_datetime,
      null::date, null::time, e.status, e.recurrence_rule is not null, e.affiliation,
      e.description, e.location
    from public.events e join public.profiles p on p.id=e.owner_user_id where e.deleted_at is null
  ), filtered as materialized (
    select * from items i where (target_entity='' or i.entity=target_entity)
      and (target_creator_user_id is null or i.creator_user_id=target_creator_user_id)
      and (target_created_from is null or i.created_at>=target_created_from)
      and (target_created_to is null or i.created_at<target_created_to)
      and (search_text='' or strpos(lower(concat_ws(' ', i.id, i.title, i.affiliation, i.creator_name, i.creator_email, i.location, i.description)), lower(search_text)) > 0)
  ), page as (
    select * from filtered order by created_at desc, entity, id offset target_offset limit target_limit
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, entity, id) from page), '[]'::jsonb),
    'total_count', (select count(*) from filtered)) into result;
  return result;
end;
$$;

revoke all on function public.admin_calendar_items(text,uuid,text,timestamptz,timestamptz,integer,integer) from public,anon;
grant execute on function public.admin_calendar_items(text,uuid,text,timestamptz,timestamptz,integer,integer) to authenticated;

commit;

