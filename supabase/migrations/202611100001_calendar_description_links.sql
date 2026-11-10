-- Track only links created by this sync; user-created links remain untouched.
create table if not exists public.google_calendar_description_links (
  link_id uuid primary key references public.document_links(id) on delete cascade,
  source_url text not null
);
alter table public.google_calendar_description_links enable row level security;
revoke all on public.google_calendar_description_links from public, anon, authenticated;

create or replace function public.sync_google_calendar_description_links()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  source_text text;
  urls text[];
  source_url text;
  new_link_id uuid;
begin
  -- Only the server-side Calendar importer uses a service-role JWT. Ordinary
  -- edits in the app must not change document links as a side effect.
  if new.google_event_id is null or coalesce(auth.role(), '') <> 'service_role' then return new; end if;

  -- Calendar descriptions may contain anchors and entity-encoded query strings.
  source_text := replace(replace(replace(replace(replace(replace(replace(replace(
    coalesce(new.description, ''), '&nbsp;', ' '), '&#160;', ' '), '&quot;', '"'),
    '&#39;', ''''), '&lt;', '<'), '&#38;', '&'), '&#x26;', '&'), '&amp;', '&');
  with anchor_urls as (
    select match[1] as candidate
    from regexp_matches(source_text, $href$href[[:space:]]*=[[:space:]]*["'](https?://[^"']+)["']$href$, 'gi') as match
  ), plain_urls as (
    select match[1] as raw_url
    from regexp_matches(regexp_replace(source_text, '<[^>]*>', ' ', 'g'),
      $url$(https?://[^[:space:]<>"']+)$url$, 'gi') as match
  ), found as (
    select candidate from anchor_urls
    union
    select case when exists(select 1 from anchor_urls a where a.candidate = p.raw_url)
      then p.raw_url else rtrim(p.raw_url, '.,;:!') end from plain_urls p
  )
  select coalesce(array_agg(distinct candidate), array[]::text[]) into urls from found
  where length(candidate) between 1 and 2048;

  -- If a person edits an auto-created link, it becomes theirs and is no longer
  -- eligible for removal by later Calendar syncs.
  delete from public.google_calendar_description_links tracked
  using public.document_links link
  where tracked.link_id = link.id and link.event_id = new.id
    and (link.url is distinct from tracked.source_url or link.display_name <> 'ลิงก์จาก Google Calendar');

  delete from public.document_links link
  using public.google_calendar_description_links tracked
  where tracked.link_id = link.id and link.event_id = new.id
    and link.url = tracked.source_url and link.display_name = 'ลิงก์จาก Google Calendar'
    and not (tracked.source_url = any(urls));

  foreach source_url in array urls loop
    if not exists (select 1 from public.document_links link where link.event_id = new.id and link.url = source_url) then
      insert into public.document_links(event_id, display_name, url, provider, added_by)
      values (new.id, 'ลิงก์จาก Google Calendar', source_url, 'google_drive', new.owner_user_id)
      returning id into new_link_id;
      insert into public.google_calendar_description_links(link_id, source_url) values (new_link_id, source_url);
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.sync_google_calendar_description_links() from public, anon, authenticated;

drop trigger if exists sync_google_calendar_description_links on public.events;
create trigger sync_google_calendar_description_links
after insert or update of description, google_event_id, owner_user_id on public.events
for each row execute function public.sync_google_calendar_description_links();
