-- Let each Meeting owner or Task creator inspect and requeue their own deliveries.
drop policy if exists deliveries_owner_or_admin_read on public.notification_deliveries;
create policy deliveries_owner_or_admin_read on public.notification_deliveries for select to authenticated
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid())
      or exists(select 1 from public.tasks t where t.id = task_id and t.creator_user_id = auth.uid())
    )
  );

create or replace function public.retry_notification_delivery(target_delivery_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.notification_deliveries%rowtype;
  new_delivery_id uuid;
  may_retry boolean;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'active authentication is required';
  end if;

  select * into original
  from public.notification_deliveries
  where id = target_delivery_id
  for update;

  if not found then
    raise exception 'notification delivery not found';
  end if;

  select public.is_admin()
    or exists(select 1 from public.events e where e.id = original.event_id and e.owner_user_id = auth.uid())
    or exists(select 1 from public.tasks t where t.id = original.task_id and t.creator_user_id = auth.uid())
  into may_retry;

  if not may_retry then
    raise exception 'not allowed to retry this notification delivery';
  end if;

  if original.status not in ('failed', 'deferred_quota') then
    raise exception 'only failed or quota-deferred deliveries can be retried';
  end if;

  if exists(
    select 1
    from public.notification_deliveries pending_delivery
    where pending_delivery.idempotency_key like 'manual-retry:' || original.id::text || ':%'
      and pending_delivery.status in ('queued', 'processing', 'retry', 'deferred_quota')
  ) then
    raise exception 'a retry is already waiting to be sent';
  end if;

  insert into public.notification_deliveries (
    reminder_id, task_reminder_id, event_id, task_id, recipient_type,
    recipient_reference, channel, idempotency_key, scheduled_at, template_key, payload
  ) values (
    original.reminder_id, original.task_reminder_id, original.event_id, original.task_id, original.recipient_type,
    original.recipient_reference, original.channel, 'manual-retry:' || original.id::text || ':' || gen_random_uuid()::text,
    now(), original.template_key, original.payload
  ) returning id into new_delivery_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'NOTIFICATION_REQUEUED', 'notification_delivery', original.id::text,
    jsonb_build_object('new_delivery_id', new_delivery_id, 'recipient', original.recipient_reference, 'channel', original.channel)
  );

  return new_delivery_id;
end;
$$;

revoke all on function public.retry_notification_delivery(uuid) from public;
grant execute on function public.retry_notification_delivery(uuid) to authenticated;
