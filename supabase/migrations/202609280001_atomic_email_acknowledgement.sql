create or replace function public.consume_email_acknowledgement(target_token_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  action public.email_acknowledgement_tokens%rowtype;
  affected_rows integer;
begin
  select * into action
  from public.email_acknowledgement_tokens
  where token_hash = target_token_hash
    and expires_at > now()
  for update;

  if not found then
    return 'invalid';
  end if;

  if action.recipient_type = 'guest' then
    update public.event_guests
    set acknowledged_at = coalesce(acknowledged_at, now())
    where event_id = action.event_id
      and lower(email) = lower(action.recipient_reference)
      and revoked_at is null;
  elsif action.recipient_type = 'external_assignee' then
    update public.task_external_recipients
    set acknowledged_at = coalesce(acknowledged_at, now())
    where task_id = action.task_id
      and lower(email) = lower(action.recipient_reference);
  else
    update public.task_internal_recipients recipient
    set acknowledged_at = coalesce(recipient.acknowledged_at, now())
    from public.profiles profile
    where recipient.task_id = action.task_id
      and profile.id = recipient.user_id
      and lower(profile.email) = lower(action.recipient_reference);
  end if;

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    return 'recipient_not_found';
  end if;

  update public.email_acknowledgement_tokens
  set consumed_at = coalesce(consumed_at, now())
  where id = action.id;

  return 'acknowledged';
end;
$$;

revoke all on function public.consume_email_acknowledgement(text) from public, anon, authenticated;
grant execute on function public.consume_email_acknowledgement(text) to service_role;
