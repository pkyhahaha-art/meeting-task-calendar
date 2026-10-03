begin;

-- Explicit Save and notify: creator confirmation plus current internal assignees.
-- Scheduled assignee and overdue reminder rules remain unchanged.
create or replace function public.queue_task_update_mobile_notifications(target_task_id uuid,target_requested_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare task public.tasks; queued integer;
begin
  select * into task from public.tasks where id=target_task_id;
  if not found or task.creator_user_id is distinct from auth.uid() or not public.is_active_user() then
    raise exception 'only the active Task creator may notify an update' using errcode='42501';
  end if;
  if task.deleted_at is not null or task.status<>'pending' or target_requested_at is null
    or task.notification_requested_at is distinct from target_requested_at then return 0; end if;
  insert into public.notification_deliveries(task_id,recipient_type,recipient_reference,channel,
    idempotency_key,scheduled_at,template_key,payload)
  select task.id,case when device.user_id=task.creator_user_id then 'task_creator' else 'task_assignee' end,
    device.id::text,'push',concat('task-mobile:',task.id,':task_updated:',extract(epoch from target_requested_at),':',device.id),
    now(),'task_updated',jsonb_build_object('entity','task','id',task.id,'title',task.title,
      'affiliation',task.affiliation,'description',task.description,'due_date',task.due_date,'due_time',task.due_time,
      'status',task.status,'push_user_id',device.user_id)
  from public.mobile_push_subscriptions device join public.profiles p on p.id=device.user_id and p.status='active'
  where device.endpoint like 'https://%' and (device.user_id=task.creator_user_id
    or device.user_id=task.assignee_user_id or exists(select 1 from public.task_internal_recipients r where r.task_id=task.id and r.user_id=device.user_id))
  on conflict(idempotency_key) do nothing;
  get diagnostics queued=row_count;
  return queued;
end;
$$;
revoke all on function public.queue_task_update_mobile_notifications(uuid,timestamptz) from public,anon;
grant execute on function public.queue_task_update_mobile_notifications(uuid,timestamptz) to authenticated;

commit;
