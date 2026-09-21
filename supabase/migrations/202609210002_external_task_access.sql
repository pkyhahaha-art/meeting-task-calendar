-- External assignees receive a single scoped, revocable Task link.
create index if not exists external_task_tokens_active_idx on public.external_task_tokens(task_id) where revoked_at is null;

create or replace function public.revoke_external_task_tokens_on_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.assignee_type = 'external' and (
    new.assignee_type is distinct from old.assignee_type
    or new.external_assignee_email is distinct from old.external_assignee_email
    or (new.deleted_at is not null and old.deleted_at is null)
  ) then
    update public.external_task_tokens set revoked_at = now() where task_id = old.id and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists revoke_external_task_tokens_on_change on public.tasks;
create trigger revoke_external_task_tokens_on_change after update of assignee_type, external_assignee_email, deleted_at on public.tasks for each row execute function public.revoke_external_task_tokens_on_change();

create or replace function public.queue_task_email_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  task_row public.tasks;
  recipient text;
  recipient_kind text;
  template text;
  payload jsonb;
begin
  task_row := new;
  template := case
    when tg_op = 'INSERT' then 'task_assigned'
    when new.status = 'completed' and old.status <> 'completed' then 'task_completed'
    when new.status = 'cancelled' then 'task_cancelled'
    else 'task_updated'
  end;
  payload := jsonb_build_object('entity', 'task', 'id', task_row.id, 'title', task_row.title,
    'description', task_row.description, 'due_date', task_row.due_date, 'due_time', task_row.due_time, 'status', task_row.status);
  if template = 'task_completed' then
    select p.email into recipient from public.profiles p where p.id = task_row.creator_user_id;
    perform public.queue_notification(null, task_row.id, 'task_creator', recipient, template, payload);
    return new;
  end if;
  -- External assignment is queued by the Edge Function only after it has issued a usable scoped link.
  if task_row.assignee_type = 'external' and template in ('task_assigned', 'task_updated') then return new; end if;
  if task_row.assignee_type = 'internal' then
    recipient_kind := 'task_assignee';
    select p.email into recipient from public.profiles p where p.id = task_row.assignee_user_id;
  else
    recipient_kind := 'external_assignee';
    recipient := task_row.external_assignee_email;
  end if;
  perform public.queue_notification(null, task_row.id, recipient_kind, recipient, template, payload);
  return new;
end;
$$;
