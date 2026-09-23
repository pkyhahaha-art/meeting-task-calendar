-- Keep Meeting reads organization-wide while limiting every write to the
-- Meeting owner or an active Admin. Creation derives ownership from auth.uid().

-- Repair Auth users whose profile lifecycle row is missing. Without
-- this row is_active_user() correctly rejects every Meeting write.
insert into public.profiles (
  id,
  full_name,
  email,
  employee_id,
  email_verified_at,
  status
)
select
  auth_user.id,
  coalesce(nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''), 'New user'),
  lower(auth_user.email),
  case
    when auth_user.email_confirmed_at is not null
      then nullif(upper(trim(auth_user.raw_user_meta_data ->> 'employee_id')), '')
    else null
  end,
  auth_user.email_confirmed_at,
  case when auth_user.email_confirmed_at is not null then 'active' else 'pending_verification' end
from auth.users auth_user
where auth_user.email is not null
  and not exists (
    select 1 from public.profiles profile where profile.id = auth_user.id
  );

-- The original confirmation trigger only updated an existing profile. Upsert
-- here so a missing lifecycle row is restored when confirmation is processed.
create or replace function public.activate_confirmed_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    insert into public.profiles as profile (
      id,
      full_name,
      email,
      employee_id,
      email_verified_at,
      status
    ) values (
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New user'),
      lower(new.email),
      nullif(upper(trim(new.raw_user_meta_data ->> 'employee_id')), ''),
      new.email_confirmed_at,
      'active'
    )
    on conflict (id) do update
      set employee_id = excluded.employee_id,
          email_verified_at = excluded.email_verified_at,
          status = case
            when profile.status = 'pending_verification' then 'active'
            else profile.status
          end;
  end if;
  return new;
end;
$$;

create or replace function public.can_read_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events event
    join public.profiles actor on actor.id = auth.uid()
    where event.id = target_event_id
      and actor.status = 'active'
      and (event.deleted_at is null or event.owner_user_id = auth.uid() or actor.role = 'admin')
  );
$$;

create or replace function public.can_manage_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events event
    join public.profiles actor on actor.id = auth.uid()
    where event.id = target_event_id
      and actor.status = 'active'
      and (event.owner_user_id = auth.uid() or actor.role = 'admin')
  );
$$;

revoke all on function public.can_read_event(uuid) from public;
revoke all on function public.can_manage_event(uuid) from public;
grant execute on function public.can_read_event(uuid) to authenticated;
grant execute on function public.can_manage_event(uuid) to authenticated;

drop policy if exists events_read_active on public.events;
drop policy if exists events_insert_own on public.events;
drop policy if exists events_update_owner on public.events;
create policy events_read_active on public.events for select to authenticated
  using (public.is_active_user() and (deleted_at is null or owner_user_id = auth.uid() or public.is_admin()));
create policy events_insert_own on public.events for insert to authenticated
  with check (owner_user_id = auth.uid() and public.is_active_user());
create policy events_update_owner on public.events for update to authenticated
  using (public.is_active_user() and (owner_user_id = auth.uid() or public.is_admin()))
  with check (public.is_active_user() and (owner_user_id = auth.uid() or public.is_admin()));
revoke delete on table public.events from authenticated;

drop policy if exists guests_owner_all on public.event_guests;
drop policy if exists guests_read_active on public.event_guests;
drop policy if exists guests_insert_manager on public.event_guests;
drop policy if exists guests_update_manager on public.event_guests;
drop policy if exists guests_delete_manager on public.event_guests;
create policy guests_read_active on public.event_guests for select to authenticated
  using (public.can_read_event(event_id));
create policy guests_insert_manager on public.event_guests for insert to authenticated
  with check (public.can_manage_event(event_id));
create policy guests_update_manager on public.event_guests for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));
create policy guests_delete_manager on public.event_guests for delete to authenticated
  using (public.can_manage_event(event_id));

drop policy if exists reminders_owner_all on public.reminders;
drop policy if exists reminders_read_active on public.reminders;
drop policy if exists reminders_insert_manager on public.reminders;
drop policy if exists reminders_update_manager on public.reminders;
drop policy if exists reminders_delete_manager on public.reminders;
create policy reminders_read_active on public.reminders for select to authenticated
  using (public.can_read_event(event_id));
create policy reminders_insert_manager on public.reminders for insert to authenticated
  with check (public.can_manage_event(event_id));
create policy reminders_update_manager on public.reminders for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));
create policy reminders_delete_manager on public.reminders for delete to authenticated
  using (public.can_manage_event(event_id));

drop policy if exists attachments_read_active on public.attachments;
drop policy if exists attachments_owner_all on public.attachments;
drop policy if exists attachments_insert_manager on public.attachments;
drop policy if exists attachments_update_manager on public.attachments;
drop policy if exists attachments_delete_manager on public.attachments;
create policy attachments_read_active on public.attachments for select to authenticated
  using (public.can_read_event(event_id));
create policy attachments_insert_manager on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_manage_event(event_id));
create policy attachments_update_manager on public.attachments for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));
create policy attachments_delete_manager on public.attachments for delete to authenticated
  using (public.can_manage_event(event_id));

drop policy if exists storage_meeting_read on storage.objects;
drop policy if exists storage_meeting_insert on storage.objects;
drop policy if exists storage_meeting_update on storage.objects;
drop policy if exists storage_meeting_delete on storage.objects;
create policy storage_meeting_read on storage.objects for select to authenticated
  using (
    bucket_id = 'meeting-documents'
    and exists (
      select 1 from public.attachments attachment
      where attachment.storage_path = name
        and public.can_read_event(attachment.event_id)
    )
  );
create policy storage_meeting_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'meeting-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_user()
  );
create policy storage_meeting_update on storage.objects for update to authenticated
  using (
    bucket_id = 'meeting-documents'
    and public.is_active_user()
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1 from public.attachments attachment
        where attachment.storage_path = name
          and public.can_manage_event(attachment.event_id)
      )
    )
  )
  with check (
    bucket_id = 'meeting-documents'
    and public.is_active_user()
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1 from public.attachments attachment
        where attachment.storage_path = name
          and public.can_manage_event(attachment.event_id)
      )
    )
  );
create policy storage_meeting_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'meeting-documents'
    and public.is_active_user()
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1 from public.attachments attachment
        where attachment.storage_path = name
          and public.can_manage_event(attachment.event_id)
      )
    )
  );

create or replace function public.create_meeting_event(
  target_title text,
  target_description text,
  target_location text,
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
    all_day,
    start_datetime,
    end_datetime,
    recurrence_rule
  ) values (
    auth.uid(),
    target_title,
    target_description,
    target_location,
    target_all_day,
    target_start_datetime,
    target_end_datetime,
    target_recurrence_rule
  )
  returning * into created_event;

  return created_event;
end;
$$;

revoke all on function public.create_meeting_event(text, text, text, boolean, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.create_meeting_event(text, text, text, boolean, timestamptz, timestamptz, text) to authenticated;
