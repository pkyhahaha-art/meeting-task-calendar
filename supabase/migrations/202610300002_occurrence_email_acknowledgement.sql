begin;

alter table public.email_acknowledgement_tokens
  add column if not exists occurrence_id uuid references public.event_occurrences(id) on delete cascade;

create table if not exists public.event_occurrence_acknowledgements (
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_id uuid not null references public.event_occurrences(id) on delete cascade,
  email text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (occurrence_id, email)
);
alter table public.event_occurrence_acknowledgements enable row level security;
revoke all on public.event_occurrence_acknowledgements from public, anon, authenticated;
grant select on public.event_occurrence_acknowledgements to authenticated;
grant select, insert, update, delete on public.event_occurrence_acknowledgements to service_role;
create policy occurrence_ack_read_active on public.event_occurrence_acknowledgements
  for select to authenticated using (public.can_read_event(event_id));

-- Existing future-scoped guests already had a series-level acknowledgement.
-- Snapshot it only for materialized appointments they currently belong to.
insert into public.event_occurrence_acknowledgements(event_id,occurrence_id,email,acknowledged_at)
  select g.event_id,o.id,lower(btrim(g.email)),g.acknowledged_at
  from public.event_guests g join public.event_occurrences o on o.event_id=g.event_id
  where g.occurrence_id is null and g.revoked_at is null and g.acknowledged_at is not null
    and (g.self_join_from is not null or g.self_join_until is not null or g.attendance_history <> '[]'::jsonb)
    and exists(select 1 from public.occurrence_guest_emails(g.event_id,o.id) eligible where eligible.email=lower(btrim(g.email)))
  on conflict (occurrence_id,email) do nothing;

-- Older acknowledgements were recorded on the series guest. Preserve their
-- meaning for past appointments and the currently retained single appointment
-- at the point the attendee changes scope, never for future appointments left.
create or replace function public.preserve_legacy_ack_before_scope_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.occurrence_id is null and old.acknowledged_at is not null and
    (old.self_join_from is distinct from new.self_join_from or old.self_join_until is distinct from new.self_join_until
      or old.attendance_history is distinct from new.attendance_history) then
    insert into public.event_occurrence_acknowledgements(event_id,occurrence_id,email,acknowledged_at)
      select old.event_id,o.id,lower(btrim(old.email)),old.acknowledged_at
      from public.event_occurrences o where o.event_id=old.event_id
        and (o.start_datetime<=now() or o.start_datetime=new.self_join_until or o.start_datetime=old.self_join_until)
        and exists(select 1 from public.occurrence_guest_emails(old.event_id,o.id) g where g.email=lower(btrim(old.email)))
      on conflict (occurrence_id,email) do nothing;
  end if;
  if old.occurrence_id is null and new.self_join_until is not null and
    (old.self_join_from is distinct from new.self_join_from or old.self_join_until is distinct from new.self_join_until
      or old.attendance_history is distinct from new.attendance_history) then
    delete from public.event_occurrence_acknowledgements ack using public.event_occurrences o
      where ack.event_id=old.event_id and ack.occurrence_id=o.id and ack.email=lower(btrim(old.email))
        and o.start_datetime>now() and o.start_datetime<>new.self_join_until;
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_legacy_ack_before_scope_change() from public, anon, authenticated;
create trigger preserve_legacy_ack_before_scope_change before update of self_join_from,self_join_until,attendance_history
  on public.event_guests for each row execute function public.preserve_legacy_ack_before_scope_change();

create or replace function public.record_occurrence_acknowledgement(target_event_id uuid, target_occurrence_id uuid, target_email text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare result timestamptz;
begin
  if not exists (select 1 from public.events e join public.event_occurrences o on o.event_id=e.id
      where e.id=target_event_id and e.deleted_at is null and e.status='scheduled'
        and o.id=target_occurrence_id and o.status='scheduled')
    or not exists (select 1 from public.occurrence_guest_emails(target_event_id,target_occurrence_id) g
      where g.email=lower(btrim(target_email))) then
    return null;
  end if;
  insert into public.event_occurrence_acknowledgements(event_id,occurrence_id,email)
    values(target_event_id,target_occurrence_id,lower(btrim(target_email)))
    on conflict (occurrence_id,email) do update set acknowledged_at=public.event_occurrence_acknowledgements.acknowledged_at
    returning acknowledged_at into result;
  return result;
end;
$$;
revoke all on function public.record_occurrence_acknowledgement(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_occurrence_acknowledgement(uuid,uuid,text) to service_role;

create or replace function public.consume_email_acknowledgement(target_token_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  action public.email_acknowledgement_tokens%rowtype;
  affected_rows integer;
  scoped_ack timestamptz;
begin
  select * into action from public.email_acknowledgement_tokens
    where token_hash=target_token_hash and expires_at>now() for update;
  if not found then return 'invalid'; end if;
  if action.recipient_type='guest' and action.occurrence_id is not null then
    scoped_ack:=public.record_occurrence_acknowledgement(action.event_id,action.occurrence_id,action.recipient_reference);
    if scoped_ack is null then return 'recipient_not_found'; end if;
  elsif action.recipient_type='guest' then
    -- Legacy unscoped links cannot authorize a changed series membership.
    if exists(select 1 from public.event_guests g where g.event_id=action.event_id
      and lower(btrim(g.email))=lower(btrim(action.recipient_reference)) and g.occurrence_id is null
      and (g.self_join_from is not null or g.self_join_until is not null or g.attendance_history <> '[]'::jsonb)) then
      return 'recipient_not_found';
    end if;
    update public.event_guests set acknowledged_at=coalesce(acknowledged_at,now())
      where event_id=action.event_id and lower(email)=lower(action.recipient_reference) and revoked_at is null;
    get diagnostics affected_rows = row_count;
    if affected_rows=0 then return 'recipient_not_found'; end if;
  elsif action.recipient_type='external_assignee' then
    update public.task_external_recipients set acknowledged_at=coalesce(acknowledged_at,now())
      where task_id=action.task_id and lower(email)=lower(action.recipient_reference);
    get diagnostics affected_rows = row_count;
    if affected_rows=0 then return 'recipient_not_found'; end if;
  else
    update public.task_internal_recipients recipient set acknowledged_at=coalesce(recipient.acknowledged_at,now())
      from public.profiles profile where recipient.task_id=action.task_id and profile.id=recipient.user_id
        and lower(profile.email)=lower(action.recipient_reference);
    get diagnostics affected_rows = row_count;
    if affected_rows=0 then return 'recipient_not_found'; end if;
  end if;
  update public.email_acknowledgement_tokens set consumed_at=coalesce(consumed_at,now()) where id=action.id;
  return 'acknowledged';
end;
$$;
revoke all on function public.consume_email_acknowledgement(text) from public, anon, authenticated;
grant execute on function public.consume_email_acknowledgement(text) to service_role;
notify pgrst, 'reload schema';
commit;
