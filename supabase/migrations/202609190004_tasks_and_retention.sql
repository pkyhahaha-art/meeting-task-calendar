-- Task module, document links, private Task attachments, and 30-day Trash retention.

alter table public.events add column if not exists deleted_at timestamptz;
drop trigger if exists events_set_purge on public.events;
drop function if exists public.set_event_purge_at();
update public.events set purge_at = null where purge_at is not null;
drop policy if exists events_delete_owner on public.events;
revoke delete on table public.events from authenticated;
drop policy if exists events_read_active on public.events;
create policy events_read_active on public.events for select to authenticated
  using (public.is_active_user() and (deleted_at is null or owner_user_id = auth.uid() or public.is_admin()));

create index if not exists events_deleted_idx on public.events(deleted_at) where deleted_at is not null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references public.profiles(id) on delete restrict,
  assignee_type text not null check (assignee_type in ('internal', 'external')),
  assignee_user_id uuid references public.profiles(id) on delete restrict,
  external_assignee_email text,
  linked_event_id uuid references public.events(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  description text not null default '' check (char_length(description) <= 10000),
  due_date date not null,
  due_time time,
  timezone text not null default 'Asia/Bangkok',
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  completed_at timestamptz,
  deleted_at timestamptz,
  recurrence_rule text,
  recurrence_series_id uuid,
  recurrence_end_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (assignee_type = 'internal' and assignee_user_id is not null and external_assignee_email is null)
    or
    (assignee_type = 'external' and assignee_user_id is null and external_assignee_email is not null)
  ),
  check (external_assignee_email is null or lower(external_assignee_email) ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@gmail[.]com$')
);

create index tasks_creator_idx on public.tasks(creator_user_id, deleted_at);
create index tasks_assignee_idx on public.tasks(assignee_user_id, deleted_at) where assignee_user_id is not null;
create index tasks_due_idx on public.tasks(due_date, due_time) where status = 'pending' and deleted_at is null;
create index tasks_series_idx on public.tasks(recurrence_series_id) where recurrence_series_id is not null;

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  reminder_key text not null check (reminder_key in ('due', '1_hour', '1_day', '3_days', 'overdue')),
  scheduled_at timestamptz not null,
  channel_email boolean not null default true,
  channel_line boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'completed', 'cancelled', 'deferred_quota')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, reminder_key, scheduled_at)
);

create index task_reminders_due_idx on public.task_reminders(scheduled_at)
  where status in ('scheduled', 'deferred_quota');

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  storage_path text not null unique,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 180),
  url text not null check (char_length(url) <= 2048),
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  added_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((event_id is not null)::integer + (task_id is not null)::integer = 1)
);

create index document_links_event_idx on public.document_links(event_id) where event_id is not null;
create index document_links_task_idx on public.document_links(task_id) where task_id is not null;

create table public.external_task_tokens (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  external_email text not null,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notification_deliveries
  add column if not exists task_id uuid references public.tasks(id) on delete set null;

alter table public.notification_deliveries drop constraint if exists notification_deliveries_recipient_type_check;
alter table public.notification_deliveries add constraint notification_deliveries_recipient_type_check
  check (recipient_type in ('owner', 'registered_user', 'guest', 'task_creator', 'task_assignee', 'external_assignee'));

alter table public.notification_deliveries drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check
  check (status in ('queued', 'processing', 'sent', 'retry', 'failed', 'skipped', 'deferred_quota'));

revoke all on table public.tasks from anon, authenticated;
revoke all on table public.task_reminders from anon, authenticated;
revoke all on table public.task_attachments from anon, authenticated;
revoke all on table public.document_links from anon, authenticated;
revoke all on table public.external_task_tokens from anon, authenticated;

grant select, insert, update on table public.tasks to authenticated;
grant select, insert, update, delete on table public.task_reminders to authenticated;
grant select, insert, delete on table public.task_attachments to authenticated;
grant select, insert, update, delete on table public.document_links to authenticated;
-- external_task_tokens intentionally has no client grant; Edge Functions use service-role access.

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger task_reminders_updated_at before update on public.task_reminders
  for each row execute function public.set_updated_at();

create or replace function public.can_read_task(target_task public.tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin()
    or target_task.creator_user_id = auth.uid()
    or (
      target_task.deleted_at is null
      and target_task.assignee_type = 'internal'
      and target_task.assignee_user_id = auth.uid()
    );
$$;

grant execute on function public.can_read_task(public.tasks) to authenticated;

alter table public.tasks enable row level security;
alter table public.task_reminders enable row level security;
alter table public.task_attachments enable row level security;
alter table public.document_links enable row level security;
alter table public.external_task_tokens enable row level security;

create policy profiles_read_employee_directory on public.profiles for select to authenticated
  using (public.is_active_user() and status = 'active');

create policy tasks_read_involved on public.tasks for select to authenticated
  using (public.is_active_user() and public.can_read_task(tasks));

create policy tasks_insert_creator on public.tasks for insert to authenticated
  with check (
    creator_user_id = auth.uid()
    and public.is_active_user()
    and (
      (assignee_type = 'internal' and exists(
        select 1 from public.profiles p where p.id = assignee_user_id and p.status = 'active'
      ))
      or assignee_type = 'external'
    )
  );

create policy tasks_update_involved on public.tasks for update to authenticated
  using (public.can_read_task(tasks))
  with check (public.can_read_task(tasks));

create or replace function public.protect_task_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.creator_user_id <> old.creator_user_id then
    raise exception 'task creator cannot be changed';
  end if;

  if old.creator_user_id = auth.uid() then
    return new;
  end if;

  if old.assignee_type = 'internal' and old.assignee_user_id = auth.uid() then
    if (to_jsonb(new) - array['status', 'completed_at', 'updated_at'])
       <> (to_jsonb(old) - array['status', 'completed_at', 'updated_at']) then
      raise exception 'task assignee may only change completion status';
    end if;
    return new;
  end if;

  raise exception 'task update is not allowed';
end;
$$;

create trigger protect_task_update before update on public.tasks
  for each row execute function public.protect_task_update();

create or replace function public.apply_task_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  elsif new.status <> 'completed' and old.status = 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger task_status_timestamp before update of status on public.tasks
  for each row execute function public.apply_task_status_change();

create or replace function public.cancel_completed_task_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('completed', 'cancelled') and old.status = 'pending' then
    update public.task_reminders
      set status = 'cancelled'
      where task_id = new.id and status in ('scheduled', 'deferred_quota');
  end if;
  return new;
end;
$$;

create trigger task_cancel_reminders after update of status on public.tasks
  for each row execute function public.cancel_completed_task_reminders();

create policy task_reminders_read_involved on public.task_reminders for select to authenticated
  using (exists(select 1 from public.tasks t where t.id = task_id and public.can_read_task(t)));
create policy task_reminders_creator_all on public.task_reminders for all to authenticated
  using (exists(select 1 from public.tasks t where t.id = task_id and (t.creator_user_id = auth.uid() or public.is_admin())))
  with check (exists(select 1 from public.tasks t where t.id = task_id and (t.creator_user_id = auth.uid() or public.is_admin())));

create policy task_attachments_read_involved on public.task_attachments for select to authenticated
  using (exists(select 1 from public.tasks t where t.id = task_id and public.can_read_task(t)));
create policy task_attachments_creator_insert on public.task_attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and exists(select 1 from public.tasks t where t.id = task_id and t.creator_user_id = auth.uid()));
create policy task_attachments_creator_delete on public.task_attachments for delete to authenticated
  using (exists(select 1 from public.tasks t where t.id = task_id and (t.creator_user_id = auth.uid() or public.is_admin())));

create policy document_links_read_authorized on public.document_links for select to authenticated
  using (
    (event_id is not null and public.is_active_user())
    or
    (task_id is not null and exists(select 1 from public.tasks t where t.id = task_id and public.can_read_task(t)))
  );
create policy document_links_owner_insert on public.document_links for insert to authenticated
  with check (
    added_by = auth.uid() and (
      (event_id is not null and exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid()))
      or
      (task_id is not null and exists(select 1 from public.tasks t where t.id = task_id and t.creator_user_id = auth.uid()))
    )
  );
create policy document_links_owner_update on public.document_links for update to authenticated
  using (
    public.is_admin()
    or (event_id is not null and exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid()))
    or (task_id is not null and exists(select 1 from public.tasks t where t.id = task_id and t.creator_user_id = auth.uid()))
  );
create policy document_links_owner_delete on public.document_links for delete to authenticated
  using (
    public.is_admin()
    or (event_id is not null and exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid()))
    or (task_id is not null and exists(select 1 from public.tasks t where t.id = task_id and t.creator_user_id = auth.uid()))
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-documents', 'task-documents', false, 10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png']
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy storage_task_read on storage.objects for select to authenticated
  using (
    bucket_id = 'task-documents'
    and exists(
      select 1 from public.task_attachments a
      join public.tasks t on t.id = a.task_id
      where a.storage_path = name and public.can_read_task(t)
    )
  );
create policy storage_task_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-documents' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());
create policy storage_task_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-documents' and owner_id = auth.uid()::text);

create or replace function public.audit_task_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case
      when tg_op = 'INSERT' then 'TASK_CREATED'
      when new.deleted_at is not null and old.deleted_at is null then 'TASK_SOFT_DELETED'
      when new.status = 'completed' and old.status <> 'completed' then 'TASK_COMPLETED'
      when new.status <> 'completed' and old.status = 'completed' then 'TASK_REOPENED'
      else 'TASK_UPDATED'
    end,
    'task',
    coalesce(new.id, old.id)::text,
    jsonb_build_object('title', coalesce(new.title, old.title))
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_tasks after insert or update on public.tasks
  for each row execute function public.audit_task_change();
