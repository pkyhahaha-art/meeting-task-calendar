-- Preserve the creator's display name with each record so all authorized
-- viewers can identify its owner without separately reading the profile.
alter table public.events add column if not exists creator_name text not null default '';
alter table public.tasks add column if not exists creator_name text not null default '';

update public.events event
set creator_name = coalesce(nullif(trim(profile.full_name), ''), 'ไม่ระบุชื่อ')
from public.profiles profile
where profile.id = event.owner_user_id
  and event.creator_name = '';

update public.tasks task
set creator_name = coalesce(nullif(trim(profile.full_name), ''), 'ไม่ระบุชื่อ')
from public.profiles profile
where profile.id = task.creator_user_id
  and task.creator_name = '';

create or replace function public.stamp_event_creator_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(trim(profile.full_name), ''), 'ไม่ระบุชื่อ')
    into new.creator_name
    from public.profiles profile
    where profile.id = new.owner_user_id;
    new.creator_name := coalesce(new.creator_name, 'ไม่ระบุชื่อ');
  elsif new.creator_name is distinct from old.creator_name then
    raise exception 'event creator name cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists events_stamp_creator_name on public.events;
create trigger events_stamp_creator_name
  before insert or update on public.events
  for each row execute function public.stamp_event_creator_name();

create or replace function public.stamp_task_creator_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(trim(profile.full_name), ''), 'ไม่ระบุชื่อ')
    into new.creator_name
    from public.profiles profile
    where profile.id = new.creator_user_id;
    new.creator_name := coalesce(new.creator_name, 'ไม่ระบุชื่อ');
  elsif new.creator_name is distinct from old.creator_name then
    raise exception 'task creator name cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_stamp_creator_name on public.tasks;
create trigger tasks_stamp_creator_name
  before insert or update on public.tasks
  for each row execute function public.stamp_task_creator_name();

-- A recipient is an individual email address so every external recipient gets
-- a distinct, revocable Task link and no recipient's email is exposed to another.
create table if not exists public.task_external_recipients (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  email text not null check (lower(email) ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@gmail[.]com$'),
  created_at timestamptz not null default now(),
  unique (task_id, email)
);

insert into public.task_external_recipients (task_id, email)
select task.id, lower(task.external_assignee_email)
from public.tasks task
where task.assignee_type = 'external'
  and task.external_assignee_email is not null
on conflict (task_id, email) do nothing;

create index if not exists task_external_recipients_task_idx on public.task_external_recipients(task_id);

grant select on table public.task_external_recipients to authenticated, service_role;
alter table public.task_external_recipients enable row level security;

drop policy if exists task_external_recipients_read_involved on public.task_external_recipients;
create policy task_external_recipients_read_involved on public.task_external_recipients for select to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1 from public.tasks task
      where task.id = task_id and public.can_read_task(task)
    )
  );

create or replace function public.revoke_external_task_tokens_on_recipient_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.external_task_tokens
  set revoked_at = now()
  where task_id = case when tg_op = 'DELETE' then old.task_id else new.task_id end
    and revoked_at is null;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists task_external_recipients_revoke_tokens on public.task_external_recipients;
create trigger task_external_recipients_revoke_tokens
  after insert or update or delete on public.task_external_recipients
  for each row execute function public.revoke_external_task_tokens_on_recipient_change();

create or replace function public.replace_task_external_recipients(
  target_task_id uuid,
  recipient_emails text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.tasks;
  normalized_emails text[];
begin
  if auth.uid() is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  select * into task_row
  from public.tasks task
  where task.id = target_task_id
  for update;

  if not found or (task_row.creator_user_id <> auth.uid() and not public.is_admin()) then
    raise exception 'only the Task creator or an Admin may manage external recipients' using errcode = '42501';
  end if;

  select coalesce(array_agg(email order by email), '{}'::text[])
  into normalized_emails
  from (
    select distinct lower(trim(recipient.raw_email)) as email
    from unnest(coalesce(recipient_emails, '{}'::text[])) as recipient(raw_email)
    where trim(recipient.raw_email) <> ''
  ) recipients;

  if task_row.assignee_type = 'external' then
    if cardinality(normalized_emails) = 0 then
      raise exception 'an external Task requires at least one recipient';
    end if;
    if exists (
      select 1 from unnest(normalized_emails) as email
      where email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@gmail[.]com$'
    ) then
      raise exception 'external recipients must be valid Gmail addresses';
    end if;
    if not (task_row.external_assignee_email = any(normalized_emails)) then
      raise exception 'the primary external recipient must be included';
    end if;
  elsif cardinality(normalized_emails) > 0 then
    raise exception 'internal Tasks cannot have external recipients';
  end if;

  delete from public.task_external_recipients where task_id = target_task_id;

  if task_row.assignee_type = 'external' then
    insert into public.task_external_recipients (task_id, email)
    select target_task_id, recipient.email from unnest(normalized_emails) as recipient(email);
  end if;
end;
$$;

revoke all on function public.replace_task_external_recipients(uuid, text[]) from public, anon;
grant execute on function public.replace_task_external_recipients(uuid, text[]) to authenticated;
