-- An email acknowledgement is scoped to its recipient and does not open the app.
create table public.email_acknowledgement_tokens (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('task_assignee', 'external_assignee', 'guest')),
  recipient_reference text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((task_id is null) <> (event_id is null))
);

create index email_acknowledgement_tokens_hash_idx on public.email_acknowledgement_tokens(token_hash);
create index email_acknowledgement_tokens_expiry_idx on public.email_acknowledgement_tokens(expires_at);
alter table public.email_acknowledgement_tokens enable row level security;
revoke all on public.email_acknowledgement_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.email_acknowledgement_tokens to service_role;
