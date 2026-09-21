alter table public.task_attachments alter column uploaded_by drop not null;

create policy task_attachments_assignee_insert on public.task_attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists(select 1 from public.tasks t where t.id = task_id and t.assignee_type = 'internal' and t.assignee_user_id = auth.uid() and t.deleted_at is null)
  );
