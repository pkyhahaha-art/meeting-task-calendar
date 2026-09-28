-- Every active employee can read calendar items. Only the creator edits or closes them.
create or replace function public.can_read_task(target_task public.tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user()
    and (target_task.deleted_at is null or target_task.creator_user_id = auth.uid());
$$;

drop policy if exists tasks_update_involved on public.tasks;
create policy tasks_update_creator on public.tasks for update to authenticated
  using (public.is_active_user() and creator_user_id = auth.uid())
  with check (public.is_active_user() and creator_user_id = auth.uid());

select set_config('app.materializing_task_series', 'true', true);
update public.tasks set notification_requested_at = created_at where notification_requested_at is null;
select set_config('app.materializing_task_series', 'false', true);

create or replace function public.protect_task_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if old.creator_user_id <> auth.uid()
    or new.creator_user_id <> old.creator_user_id then
    raise exception 'only the Task creator may change or complete this Task' using errcode = '42501';
  end if;
  return new;
end;
$$;

create table if not exists public.task_internal_recipients (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
insert into public.task_internal_recipients (task_id, user_id)
select id, assignee_user_id from public.tasks
where assignee_type = 'internal' and assignee_user_id is not null
on conflict do nothing;
create index if not exists task_internal_recipients_user_idx on public.task_internal_recipients(user_id);
grant select on public.task_internal_recipients to authenticated;
alter table public.task_internal_recipients enable row level security;
create policy task_internal_recipients_read on public.task_internal_recipients for select to authenticated
  using (exists (select 1 from public.tasks task where task.id = task_id and public.can_read_task(task)));

create or replace function public.copy_task_recipients_to_occurrence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recurrence_series_id is null then return new; end if;
  insert into public.task_internal_recipients (task_id, user_id)
    select new.id, member.user_id from public.task_internal_recipients member
    where member.task_id = new.recurrence_series_id on conflict do nothing;
  insert into public.task_external_recipients (task_id, email)
    select new.id, member.email from public.task_external_recipients member
    where member.task_id = new.recurrence_series_id on conflict do nothing;
  return new;
end;
$$;
create trigger copy_task_recipients_to_occurrence after insert on public.tasks
  for each row execute function public.copy_task_recipients_to_occurrence();

alter table public.task_external_recipients add column if not exists acknowledged_at timestamptz;
alter table public.event_guests add column if not exists acknowledged_at timestamptz;
grant update on public.task_external_recipients, public.event_guests to service_role;
drop trigger if exists task_external_recipients_revoke_tokens on public.task_external_recipients;
create or replace function public.revoke_external_task_tokens_on_recipient_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.external_task_tokens set revoked_at = now()
      where task_id = old.task_id and external_email = old.email and revoked_at is null;
    return old;
  end if;
  if new.email is distinct from old.email or new.task_id is distinct from old.task_id then
    update public.external_task_tokens set revoked_at = now()
      where task_id = old.task_id and external_email = old.email and revoked_at is null;
  end if;
  return new;
end;
$$;
create trigger task_external_recipients_revoke_tokens
  after delete or update on public.task_external_recipients
  for each row execute function public.revoke_external_task_tokens_on_recipient_change();
create or replace function public.revoke_external_task_tokens_on_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.external_task_tokens set revoked_at = now()
      where task_id = old.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create or replace function public.replace_task_internal_recipients(target_task_id uuid, recipient_user_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare task_row public.tasks; normalized uuid[];
begin
  select * into task_row from public.tasks where id = target_task_id for update;
  if not found or task_row.creator_user_id <> auth.uid() or not public.is_active_user() then
    raise exception 'only the Task creator may manage recipients' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct user_id), '{}'::uuid[]) into normalized
  from unnest(coalesce(recipient_user_ids, '{}'::uuid[])) as recipient(user_id);
  if exists (select 1 from unnest(normalized) as recipient(user_id)
    where not exists (select 1 from public.profiles profile
      where profile.id = recipient.user_id and profile.status = 'active')) then
    raise exception 'all internal recipients must be active';
  end if;
  if task_row.assignee_type = 'internal' and not (task_row.assignee_user_id = any(normalized)) then
    raise exception 'primary internal recipient must be included';
  end if;
  delete from public.task_internal_recipients recipient
    where recipient.task_id = target_task_id and not (recipient.user_id = any(normalized));
  insert into public.task_internal_recipients (task_id, user_id)
    select target_task_id, recipient.user_id from unnest(normalized) as recipient(user_id)
    on conflict do nothing;
end;
$$;
revoke all on function public.replace_task_internal_recipients(uuid, uuid[]) from public, anon;
grant execute on function public.replace_task_internal_recipients(uuid, uuid[]) to authenticated;

create or replace function public.replace_task_external_recipients(target_task_id uuid, recipient_emails text[])
returns void language plpgsql security definer set search_path = '' as $$
declare task_row public.tasks; normalized text[];
begin
  select * into task_row from public.tasks where id = target_task_id for update;
  if not found or task_row.creator_user_id <> auth.uid() or not public.is_active_user() then
    raise exception 'only the Task creator may manage recipients' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct lower(trim(raw_email))), '{}'::text[]) into normalized
    from unnest(coalesce(recipient_emails, '{}'::text[])) as recipient(raw_email)
    where trim(raw_email) <> '';
  if exists (select 1 from unnest(normalized) as recipient(email)
    where recipient.email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@gmail[.]com$') then
    raise exception 'external recipients must be valid Gmail addresses';
  end if;
  if task_row.assignee_type = 'external' and not (task_row.external_assignee_email = any(normalized)) then
    raise exception 'primary external recipient must be included';
  end if;
  delete from public.task_external_recipients recipient
    where recipient.task_id = target_task_id and not (recipient.email = any(normalized));
  insert into public.task_external_recipients (task_id, email)
    select target_task_id, recipient.email from unnest(normalized) as recipient(email)
    on conflict (task_id, email) do nothing;
end;
$$;

create or replace function public.acknowledge_task(target_task_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare acknowledged timestamptz;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'active account required' using errcode = '42501';
  end if;
  update public.task_internal_recipients recipient
    set acknowledged_at = coalesce(recipient.acknowledged_at, now())
    where recipient.task_id = target_task_id and recipient.user_id = auth.uid()
      and exists (select 1 from public.tasks task where task.id = target_task_id
        and task.deleted_at is null and task.status = 'pending')
    returning recipient.acknowledged_at into acknowledged;
  if acknowledged is null then raise exception 'Task recipient not found' using errcode = '42501'; end if;
  return acknowledged;
end;
$$;
revoke all on function public.acknowledge_task(uuid) from public, anon;
grant execute on function public.acknowledge_task(uuid) to authenticated;

-- Creation emails are queued after all recipients and documents are saved by the form.
create or replace function public.queue_task_email_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient record; template text; payload jsonb;
begin
  if current_setting('app.materializing_task_series', true) = 'true' or tg_op = 'INSERT' then return new; end if;
  if new.notification_requested_at is not distinct from old.notification_requested_at
    and new.status is not distinct from old.status then return new; end if;
  template := case when new.status = 'completed' and old.status <> 'completed' then 'task_completed'
    when new.status = 'cancelled' then 'task_cancelled'
    when old.notification_requested_at is null then 'task_assigned' else 'task_updated' end;
  payload := jsonb_build_object('entity', 'task', 'id', new.id, 'title', new.title,
    'description', new.description, 'due_date', new.due_date, 'due_time', new.due_time, 'status', new.status);
  if template = 'task_completed' then
    select profile.email into recipient from public.profiles profile where profile.id = new.creator_user_id;
    perform public.queue_notification(null, new.id, 'task_creator', recipient.email, template, payload);
    return new;
  end if;
  for recipient in select profile.email from public.task_internal_recipients member
    join public.profiles profile on profile.id = member.user_id
    where member.task_id = new.id and profile.status = 'active' loop
    perform public.queue_notification(null, new.id, 'task_assignee', recipient.email, template, payload);
  end loop;
  if template = 'task_cancelled' then
    for recipient in select email from public.task_external_recipients where task_id = new.id loop
      perform public.queue_notification(null, new.id, 'external_assignee', recipient.email, template, payload);
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.queue_due_email_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  event_reminder record; task_reminder record; recipient record;
  creator_email text; overdue_day integer; delivery_scheduled_at timestamptz;
  queued_count integer := 0;
begin
  for event_reminder in
    select r.id, r.scheduled_at, e.id as event_id, e.owner_user_id, e.title, e.description,
      e.start_datetime, e.end_datetime, e.location, e.status, e.deleted_at
    from public.reminders r join public.events e on e.id = r.event_id
    where r.status = 'scheduled' and r.channel_email and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if event_reminder.status <> 'scheduled' or event_reminder.deleted_at is not null then
      update public.reminders set status = 'cancelled' where id = event_reminder.id;
      continue;
    end if;
    select profile.email into creator_email from public.profiles profile where profile.id = event_reminder.owner_user_id;
    perform public.queue_email_reminder_delivery(event_reminder.id, event_reminder.event_id, null,
      'owner', creator_email, 'meeting_reminder',
      jsonb_build_object('entity', 'meeting', 'id', event_reminder.event_id,
        'title', event_reminder.title, 'description', event_reminder.description,
        'start_datetime', event_reminder.start_datetime, 'end_datetime', event_reminder.end_datetime,
        'location', event_reminder.location), event_reminder.scheduled_at);
    for recipient in select email from public.event_guests
      where event_id = event_reminder.event_id and revoked_at is null loop
      perform public.queue_email_reminder_delivery(event_reminder.id, event_reminder.event_id, null,
        'guest', recipient.email, 'meeting_reminder',
        jsonb_build_object('entity', 'meeting', 'id', event_reminder.event_id,
          'title', event_reminder.title, 'description', event_reminder.description,
          'start_datetime', event_reminder.start_datetime, 'end_datetime', event_reminder.end_datetime,
          'location', event_reminder.location), event_reminder.scheduled_at);
    end loop;
    update public.reminders set status = 'completed' where id = event_reminder.id;
    queued_count := queued_count + 1;
  end loop;

  for task_reminder in
    select r.id, r.reminder_key, r.scheduled_at, t.id as task_id, t.creator_user_id,
      t.title, t.description, t.due_date, t.due_time, t.status, t.deleted_at
    from public.task_reminders r join public.tasks t on t.id = r.task_id
    where r.status = 'scheduled' and r.channel_email and r.scheduled_at <= now()
    for update of r skip locked
  loop
    if task_reminder.status <> 'pending' or task_reminder.deleted_at is not null then
      update public.task_reminders set status = 'cancelled' where id = task_reminder.id;
      continue;
    end if;
    if task_reminder.reminder_key = 'overdue' then
      overdue_day := (now() at time zone 'Asia/Bangkok')::date
        - (task_reminder.scheduled_at at time zone 'Asia/Bangkok')::date;
      if overdue_day > 2 then
        update public.task_reminders set status = 'completed' where id = task_reminder.id;
        continue;
      end if;
      delivery_scheduled_at := task_reminder.scheduled_at + overdue_day * interval '1 day';
    else
      delivery_scheduled_at := task_reminder.scheduled_at;
    end if;
    for recipient in select profile.email from public.task_internal_recipients member
      join public.profiles profile on profile.id = member.user_id
      where member.task_id = task_reminder.task_id and profile.status = 'active' loop
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'task_assignee', recipient.email, 'task_reminder',
        jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
          'title', task_reminder.title, 'description', task_reminder.description,
          'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time), delivery_scheduled_at);
    end loop;
    for recipient in select email from public.task_external_recipients
      where task_id = task_reminder.task_id loop
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'external_assignee', recipient.email, 'task_reminder',
        jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
          'title', task_reminder.title, 'description', task_reminder.description,
          'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time), delivery_scheduled_at);
    end loop;
    if task_reminder.reminder_key = 'overdue' then
      select profile.email into creator_email from public.profiles profile where profile.id = task_reminder.creator_user_id;
      perform public.queue_email_reminder_delivery(task_reminder.id, null, task_reminder.task_id,
        'task_creator', creator_email, 'task_reminder',
        jsonb_build_object('entity', 'task', 'id', task_reminder.task_id,
          'title', task_reminder.title, 'description', task_reminder.description,
          'due_date', task_reminder.due_date, 'due_time', task_reminder.due_time), delivery_scheduled_at);
    end if;
    if task_reminder.reminder_key <> 'overdue' or overdue_day = 2 then
      update public.task_reminders set status = 'completed' where id = task_reminder.id;
    end if;
    queued_count := queued_count + 1;
  end loop;
  return queued_count;
end;
$$;

-- Meeting and Task writes follow the same creator-only rule.
create or replace function public.can_manage_event(target_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events event
    where event.id = target_event_id and event.owner_user_id = auth.uid() and public.is_active_user());
$$;
drop policy if exists events_update_owner on public.events;
create policy events_update_owner on public.events for update to authenticated
  using (public.is_active_user() and owner_user_id = auth.uid())
  with check (public.is_active_user() and owner_user_id = auth.uid());

drop policy if exists occurrence_owner_all on public.event_occurrences;
create policy occurrence_owner_all on public.event_occurrences for all to authenticated
  using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));

drop policy if exists task_reminders_creator_all on public.task_reminders;
create policy task_reminders_creator_all on public.task_reminders for all to authenticated
  using (exists (select 1 from public.tasks task where task.id = task_id and task.creator_user_id = auth.uid()))
  with check (exists (select 1 from public.tasks task where task.id = task_id and task.creator_user_id = auth.uid()));
drop policy if exists task_attachments_creator_insert on public.task_attachments;
create policy task_attachments_creator_insert on public.task_attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (select 1 from public.tasks task
    where task.id = task_id and task.creator_user_id = auth.uid() and task.deleted_at is null));
drop policy if exists task_attachments_creator_delete on public.task_attachments;
create policy task_attachments_creator_delete on public.task_attachments for delete to authenticated
  using (exists (select 1 from public.tasks task where task.id = task_id and task.creator_user_id = auth.uid()));
drop policy if exists document_links_owner_update on public.document_links;
create policy document_links_owner_update on public.document_links for update to authenticated
  using ((event_id is not null and public.can_manage_event(event_id))
    or (task_id is not null and exists (select 1 from public.tasks task where task.id = task_id and task.creator_user_id = auth.uid())));
drop policy if exists document_links_owner_delete on public.document_links;
create policy document_links_owner_delete on public.document_links for delete to authenticated
  using ((event_id is not null and public.can_manage_event(event_id))
    or (task_id is not null and exists (select 1 from public.tasks task where task.id = task_id and task.creator_user_id = auth.uid())));

drop policy if exists storage_task_insert on storage.objects;
create policy storage_task_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-documents' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.tasks task where task.id::text = (storage.foldername(name))[2]
      and task.creator_user_id = auth.uid() and task.deleted_at is null));
drop policy if exists storage_task_delete on storage.objects;
create policy storage_task_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-documents' and exists (select 1 from public.task_attachments attachment
    join public.tasks task on task.id = attachment.task_id
    where attachment.storage_path = name and task.creator_user_id = auth.uid()));
drop policy if exists storage_meeting_insert on storage.objects;
create policy storage_meeting_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meeting-documents' and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.events event where event.id::text = (storage.foldername(name))[2]
      and event.owner_user_id = auth.uid() and event.deleted_at is null));
drop policy if exists storage_meeting_update on storage.objects;
create policy storage_meeting_update on storage.objects for update to authenticated
  using (bucket_id = 'meeting-documents' and exists (select 1 from public.attachments attachment
    where attachment.storage_path = name and public.can_manage_event(attachment.event_id)))
  with check (bucket_id = 'meeting-documents' and exists (select 1 from public.attachments attachment
    where attachment.storage_path = name and public.can_manage_event(attachment.event_id)));
drop policy if exists storage_meeting_delete on storage.objects;
create policy storage_meeting_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-documents' and exists (select 1 from public.attachments attachment
    where attachment.storage_path = name and public.can_manage_event(attachment.event_id)));
