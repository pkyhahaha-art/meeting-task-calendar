-- Meeting Calendar MVP schema, security policies, and Auth profile lifecycle.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id text unique,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null unique,
  email_verified_at timestamptz,
  role text not null default 'user' check (role in ('user', 'admin')),
  ui_language text not null default 'th' check (ui_language in ('th', 'en')),
  status text not null default 'pending_verification' check (status in ('pending_verification', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.line_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  line_user_id text not null unique,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 180),
  description text not null default '' check (char_length(description) <= 10000),
  start_datetime timestamptz not null,
  end_datetime timestamptz,
  all_day boolean not null default false,
  location text not null default '' check (char_length(location) <= 250),
  timezone text not null default 'Asia/Bangkok',
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer check (recurrence_count is null or recurrence_count > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_datetime is null or end_datetime >= start_datetime)
);

create index events_start_idx on public.events(start_datetime);
create index events_owner_idx on public.events(owner_user_id);
create index events_purge_idx on public.events(purge_at) where purge_at is not null;

create table public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_key timestamptz not null,
  start_datetime timestamptz not null,
  end_datetime timestamptz,
  override_payload jsonb not null default '{}'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'deleted')),
  purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, occurrence_key),
  check (end_datetime is null or end_datetime >= start_datetime)
);

create index event_occurrences_window_idx on public.event_occurrences(start_datetime, status);
create index event_occurrences_purge_idx on public.event_occurrences(purge_at) where purge_at is not null;

create table public.event_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(event_id, email)
);

create table public.guest_tokens (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.event_guests(id) on delete cascade,
  occurrence_id uuid references public.event_occurrences(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_id uuid references public.event_occurrences(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  storage_path text not null unique,
  scope text not null default 'series' check (scope in ('series', 'occurrence')),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_id uuid references public.event_occurrences(id) on delete cascade,
  offset_value integer not null check (offset_value > 0),
  offset_unit text not null check (offset_unit in ('minute', 'hour', 'day', 'week', 'month')),
  scheduled_at timestamptz not null,
  channel_email boolean not null default true,
  channel_line boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reminders_due_idx on public.reminders(scheduled_at) where status = 'scheduled';

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references public.reminders(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  recipient_type text not null check (recipient_type in ('owner', 'registered_user', 'guest')),
  recipient_reference text not null,
  channel text not null check (channel in ('email', 'line')),
  idempotency_key text not null unique,
  attempt integer not null default 0 check (attempt between 0 and 3),
  scheduled_at timestamptz not null,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'retry', 'failed', 'skipped')),
  provider_reference text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_delivery_queue_idx on public.notification_deliveries(coalesce(next_attempt_at, scheduled_at)) where status in ('queued', 'retry');

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs(created_at);

create table public.system_logs (
  id bigint generated always as identity primary key,
  job_name text not null,
  run_id uuid not null default gen_random_uuid(),
  status text not null check (status in ('started', 'completed', 'failed')),
  processed_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Explicit Data API privileges. The project is configured not to expose new
-- tables automatically, so only the operations used by the web app are granted.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.line_connections from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.event_occurrences from anon, authenticated;
revoke all on table public.event_guests from anon, authenticated;
revoke all on table public.guest_tokens from anon, authenticated;
revoke all on table public.attachments from anon, authenticated;
revoke all on table public.reminders from anon, authenticated;
revoke all on table public.notification_deliveries from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;
revoke all on table public.system_logs from anon, authenticated;

grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.line_connections to authenticated;
grant select, insert, update, delete on table public.events to authenticated;
grant select, insert, update, delete on table public.event_occurrences to authenticated;
grant select, insert, update, delete on table public.event_guests to authenticated;
grant select, insert, update, delete on table public.attachments to authenticated;
grant select, insert, update, delete on table public.reminders to authenticated;
grant select on table public.notification_deliveries to authenticated;
grant select on table public.audit_logs to authenticated;
grant select on table public.system_logs to authenticated;

-- guest_tokens has no client grant. Guest endpoints use server-side service-role access.

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger events_updated_at before update on public.events for each row execute function public.set_updated_at();
create trigger occurrences_updated_at before update on public.event_occurrences for each row execute function public.set_updated_at();
create trigger reminders_updated_at before update on public.reminders for each row execute function public.set_updated_at();
create trigger deliveries_updated_at before update on public.notification_deliveries for each row execute function public.set_updated_at();

create or replace function public.set_event_purge_at()
returns trigger language plpgsql set search_path = '' as $$
declare effective_end timestamptz;
begin
  effective_end := coalesce(new.end_datetime, new.start_datetime + case when new.all_day then interval '1 day' else interval '0 seconds' end);
  new.purge_at := effective_end + interval '72 hours';
  return new;
end;
$$;

create trigger events_set_purge before insert or update of start_datetime, end_datetime, all_day on public.events for each row execute function public.set_event_purge_at();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, employee_id, email_verified_at, status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New user'),
    lower(new.email),
    case when new.email_confirmed_at is not null then upper(trim(new.raw_user_meta_data ->> 'employee_id')) else null end,
    new.email_confirmed_at,
    case when new.email_confirmed_at is not null then 'active' else 'pending_verification' end
  );
  return new;
end;
$$;

create trigger auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create or replace function public.activate_confirmed_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.profiles
      set employee_id = upper(trim(new.raw_user_meta_data ->> 'employee_id')),
          email_verified_at = new.email_confirmed_at,
          status = 'active'
      where id = new.id;
  end if;
  return new;
end;
$$;

create trigger auth_user_confirmed after update of email_confirmed_at on auth.users for each row execute function public.activate_confirmed_auth_user();

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'admin');
$$;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.line_connections enable row level security;
alter table public.events enable row level security;
alter table public.event_occurrences enable row level security;
alter table public.event_guests enable row level security;
alter table public.guest_tokens enable row level security;
alter table public.attachments enable row level security;
alter table public.reminders enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_logs enable row level security;

create policy profiles_read_own_or_admin on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid() and public.is_active_user()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name, ui_language) on public.profiles to authenticated;

create policy line_read_own_or_admin on public.line_connections for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy events_read_active on public.events for select to authenticated using (public.is_active_user());
create policy events_insert_own on public.events for insert to authenticated with check (owner_user_id = auth.uid() and public.is_active_user());
create policy events_update_owner on public.events for update to authenticated using (owner_user_id = auth.uid() or public.is_admin()) with check (owner_user_id = auth.uid() or public.is_admin());
create policy events_delete_owner on public.events for delete to authenticated using (owner_user_id = auth.uid() or public.is_admin());

create or replace function public.prevent_event_owner_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_user_id <> old.owner_user_id then raise exception 'event owner cannot be changed'; end if;
  return new;
end;
$$;
create trigger event_owner_immutable before update on public.events for each row execute function public.prevent_event_owner_change();

create policy occurrence_read_active on public.event_occurrences for select to authenticated using (public.is_active_user());
create policy occurrence_owner_all on public.event_occurrences for all to authenticated
  using (exists(select 1 from public.events e where e.id = event_id and (e.owner_user_id = auth.uid() or public.is_admin())))
  with check (exists(select 1 from public.events e where e.id = event_id and (e.owner_user_id = auth.uid() or public.is_admin())));

create policy guests_owner_all on public.event_guests for all to authenticated
  using (exists(select 1 from public.events e where e.id = event_id and (e.owner_user_id = auth.uid() or public.is_admin())))
  with check (exists(select 1 from public.events e where e.id = event_id and (e.owner_user_id = auth.uid() or public.is_admin())));

create policy attachments_read_active on public.attachments for select to authenticated using (public.is_active_user());
create policy attachments_owner_all on public.attachments for all to authenticated
  using (exists(select 1 from public.events e where e.id = event_id and (e.owner_user_id = auth.uid() or public.is_admin())))
  with check (uploaded_by = auth.uid() and exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid()));

create policy reminders_owner_all on public.reminders for all to authenticated
  using (exists(select 1 from public.events e where e.id = event_id and (e.owner_user_id = auth.uid() or public.is_admin())))
  with check (exists(select 1 from public.events e where e.id = event_id and (e.owner_user_id = auth.uid() or public.is_admin())));

create policy deliveries_owner_or_admin_read on public.notification_deliveries for select to authenticated
  using (public.is_admin() or exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid()));
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.is_admin());
create policy system_admin_read on public.system_logs for select to authenticated using (public.is_admin());

-- guest_tokens intentionally has no client policy. Edge Functions use service-role access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting-documents', 'meeting-documents', false, 10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png']
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy storage_meeting_read on storage.objects for select to authenticated
  using (bucket_id = 'meeting-documents' and public.is_active_user());
create policy storage_meeting_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meeting-documents' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());
create policy storage_meeting_update on storage.objects for update to authenticated
  using (bucket_id = 'meeting-documents' and owner_id = auth.uid()::text)
  with check (bucket_id = 'meeting-documents' and owner_id = auth.uid()::text);
create policy storage_meeting_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-documents' and owner_id = auth.uid()::text);

create or replace function public.audit_event_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when tg_op = 'INSERT' then 'EVENT_CREATED' when tg_op = 'UPDATE' then 'EVENT_UPDATED' else 'EVENT_DELETED' end,
    'event',
    coalesce(new.id, old.id)::text,
    jsonb_build_object('title', coalesce(new.title, old.title))
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_events after insert or update or delete on public.events for each row execute function public.audit_event_change();
