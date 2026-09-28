-- Assignees may read Task documents, but only the creator or an Admin may add or remove them.
drop policy if exists task_attachments_assignee_insert on public.task_attachments;

drop policy if exists task_attachments_creator_insert on public.task_attachments;
create policy task_attachments_creator_insert on public.task_attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.is_active_user()
    and exists (
      select 1 from public.tasks task
      where task.id = task_id
        and task.deleted_at is null
        and (task.creator_user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists storage_task_insert on storage.objects;
create policy storage_task_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_user()
    and exists (
      select 1 from public.tasks task
      where task.id::text = (storage.foldername(name))[2]
        and task.deleted_at is null
        and (task.creator_user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists storage_task_delete on storage.objects;
create policy storage_task_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-documents'
    and exists (
      select 1 from public.task_attachments attachment
      join public.tasks task on task.id = attachment.task_id
      where attachment.storage_path = name
        and (task.creator_user_id = auth.uid() or public.is_admin())
    )
  );
