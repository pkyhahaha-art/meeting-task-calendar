-- Run only against a disposable test database. All fixtures roll back.
begin;
do $test$
declare
  owner_id uuid;
  owner_email text;
  meeting_id uuid;
  auto_id uuid;
  manual_id uuid;
  sync_id text := 'fixture-rpc-' || gen_random_uuid()::text;
begin
  select id, email into owner_id, owner_email from public.profiles where status = 'active' and email is not null order by id limit 1;
  if owner_id is null then raise exception 'active test profile required'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.events(owner_user_id, title, start_datetime, google_event_id, description, grc_category_key, committee_key)
  values (owner_id, 'Calendar URL fixture', '2200-11-24T10:00:00+07:00', 'fixture-' || gen_random_uuid(),
    'Plain: https://example.org/doc https://example.org/prose. <a href="https://example.org/search?a=1&amp;b=2">link</a> <a href="https://example.org/a!">https://example.org/a!</a> <a href="https://example.org/a.">https://example.org/a.</a> https://en.wikipedia.org/wiki/Function_(mathematics) https://example.org/?', 'S001', 'C001')
  returning id into meeting_id;
  if (select count(*) from public.document_links where event_id = meeting_id) <> 7
    or not exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/search?a=1&b=2')
    or not exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/a!')
    or not exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/a.')
    or not exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/prose')
    or not exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://en.wikipedia.org/wiki/Function_(mathematics)')
    or not exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/?') then
    raise exception 'plain or HTML URL missing';
  end if;

  update public.events set description = description where id = meeting_id;
  if (select count(*) from public.document_links where event_id = meeting_id) <> 7 then
    raise exception 'repeated sync duplicated links';
  end if;
  select id into auto_id from public.document_links where event_id = meeting_id and url = 'https://example.org/doc';
  update public.document_links set display_name = 'ผู้ใช้แก้ชื่อเอง' where id = auto_id;
  insert into public.document_links(event_id, display_name, url, added_by)
    values(meeting_id, 'ลิงก์เพิ่มเอง', 'https://example.org/manual', owner_id) returning id into manual_id;
  update public.events set description = 'Updated https://example.org/new' where id = meeting_id;
  if not exists(select 1 from public.document_links where id = manual_id)
    or not exists(select 1 from public.document_links where id = auto_id)
    or exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/search?a=1&b=2')
    or not exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/new') then
    raise exception 'sync did not preserve user links or remove stale generated links';
  end if;

  -- A manually added matching URL is reused and must not be deleted later.
  update public.events set description = 'https://example.org/manual' where id = meeting_id;
  update public.events set description = '' where id = meeting_id;
  if not exists(select 1 from public.document_links where id = manual_id) then
    raise exception 'manual matching link was removed';
  end if;

  -- Edits from the app do not auto-create or delete links.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  update public.events set description = 'https://example.org/user-edit' where id = meeting_id;
  if exists(select 1 from public.document_links where event_id = meeting_id and url = 'https://example.org/user-edit')
    or not exists(select 1 from public.document_links where id = manual_id) then
    raise exception 'ordinary user edit changed linked documents';
  end if;

  -- Exercise the same four-argument RPC called by the occurrences importer.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.sync_google_calendar_events(jsonb_build_array(jsonb_build_object(
    'google_event_id', sync_id, 'calendar_owner_email', owner_email,
    'calendar_owner_name', 'Fixture', 'title', 'Calendar RPC URL fixture',
    'start_time', '2200-11-24T10:00:00+07:00', 'end_time', '2200-11-24T11:00:00+07:00',
    'description', '<a href="https://example.org/rpc?a=1&amp;b=2">document</a>'
  )), null, null, null);
  if not exists(select 1 from public.events e join public.document_links l on l.event_id = e.id
    where e.google_event_id = sync_id and l.url = 'https://example.org/rpc?a=1&b=2') then
    raise exception 'four-argument Calendar RPC did not create a URL';
  end if;
end;
$test$;
rollback;
