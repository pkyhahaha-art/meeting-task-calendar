begin;

-- Called after a new Task is saved and Mobile notifications were selected.
-- This creator confirmation is separate from assignee/overdue reminders.
create or replace function public.queue_task_creation_mobile_confirmation(target_task_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare task public.tasks; queued integer;
begin
  select * into task from public.tasks where id=target_task_id;
  if not found or task.creator_user_id is distinct from auth.uid() or not public.is_active_user() then
    raise exception 'only the active Task creator may confirm creation' using errcode='42501';
  end if;
  if task.deleted_at is not null or task.status <> 'pending' then return 0; end if;

  insert into public.notification_deliveries(task_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload)
  select task.id,'task_creator',device.id::text,'push',
    concat('task-mobile:',task.id,':task_created:initial:',device.id),now(),'task_created',
    jsonb_build_object('entity','task','id',task.id,'title',task.title,
      'description',task.description,'due_date',task.due_date,'due_time',task.due_time,
      'push_user_id',task.creator_user_id)
  from public.mobile_push_subscriptions device
  where device.user_id=task.creator_user_id and device.endpoint like 'https://%'
  on conflict(idempotency_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke all on function public.queue_task_creation_mobile_confirmation(uuid) from public,anon;
grant execute on function public.queue_task_creation_mobile_confirmation(uuid) to authenticated;

commit;
