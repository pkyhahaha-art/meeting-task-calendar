-- Store the organization/affiliation shown on Meeting and Task forms.
alter table public.events add column if not exists affiliation text not null default '';
alter table public.events drop constraint if exists events_affiliation_length;
alter table public.events add constraint events_affiliation_length
  check (char_length(affiliation) <= 250);

alter table public.tasks add column if not exists affiliation text not null default '';
alter table public.tasks drop constraint if exists tasks_affiliation_length;
alter table public.tasks add constraint tasks_affiliation_length
  check (char_length(affiliation) <= 250);

-- Enforce the Bangkok calendar date at the database boundary so browser-side
-- validation cannot create historical items.
create or replace function public.prevent_past_event_creation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.start_datetime at time zone 'Asia/Bangkok')::date < (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'cannot create a Meeting before today in Asia/Bangkok';
  end if;
  return new;
end;
$$;

drop trigger if exists events_prevent_past_creation on public.events;
create trigger events_prevent_past_creation
  before insert on public.events
  for each row execute function public.prevent_past_event_creation();

create or replace function public.prevent_past_task_creation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.due_date < (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'cannot create a Task before today in Asia/Bangkok';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_prevent_past_creation on public.tasks;
create trigger tasks_prevent_past_creation
  before insert on public.tasks
  for each row execute function public.prevent_past_task_creation();

drop function if exists public.create_meeting_event(text, text, text, boolean, timestamptz, timestamptz, text);
create function public.create_meeting_event(
  target_title text,
  target_description text,
  target_location text,
  target_affiliation text,
  target_all_day boolean,
  target_start_datetime timestamptz,
  target_end_datetime timestamptz,
  target_recurrence_rule text
)
returns public.events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_event public.events;
begin
  if not public.is_active_user() then
    raise exception 'active employee account required' using errcode = '42501';
  end if;

  insert into public.events (
    owner_user_id,
    title,
    description,
    location,
    affiliation,
    all_day,
    start_datetime,
    end_datetime,
    recurrence_rule
  ) values (
    auth.uid(),
    target_title,
    target_description,
    target_location,
    coalesce(target_affiliation, ''),
    target_all_day,
    target_start_datetime,
    target_end_datetime,
    target_recurrence_rule
  )
  returning * into created_event;

  return created_event;
end;
$$;

revoke all on function public.create_meeting_event(text, text, text, text, boolean, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.create_meeting_event(text, text, text, text, boolean, timestamptz, timestamptz, text) to authenticated;
