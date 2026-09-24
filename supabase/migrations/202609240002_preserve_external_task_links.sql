-- Keep links from previous Task emails valid when the Task and its recipients
-- have not changed. Recipient changes still revoke every active link.
create or replace function public.replace_task_external_recipients(
  target_task_id uuid,
  recipient_emails text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.tasks;
  normalized_emails text[];
  current_emails text[];
begin
  if auth.uid() is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  select * into task_row
  from public.tasks task
  where task.id = target_task_id
  for update;

  if not found or (task_row.creator_user_id <> auth.uid() and not public.is_admin()) then
    raise exception 'only the Task creator or an Admin may manage external recipients' using errcode = '42501';
  end if;

  select coalesce(array_agg(email order by email), '{}'::text[])
  into normalized_emails
  from (
    select distinct lower(trim(recipient.raw_email)) as email
    from unnest(coalesce(recipient_emails, '{}'::text[])) as recipient(raw_email)
    where trim(recipient.raw_email) <> ''
  ) recipients;

  if task_row.assignee_type = 'external' then
    if cardinality(normalized_emails) = 0 then
      raise exception 'an external Task requires at least one recipient';
    end if;
    if exists (
      select 1 from unnest(normalized_emails) as recipient(email)
      where recipient.email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@gmail[.]com$'
    ) then
      raise exception 'external recipients must be valid Gmail addresses';
    end if;
    if not (task_row.external_assignee_email = any(normalized_emails)) then
      raise exception 'the primary external recipient must be included';
    end if;
  elsif cardinality(normalized_emails) > 0 then
    raise exception 'internal Tasks cannot have external recipients';
  end if;

  select coalesce(array_agg(recipient.email order by recipient.email), '{}'::text[])
  into current_emails
  from public.task_external_recipients recipient
  where recipient.task_id = target_task_id;

  if current_emails is not distinct from normalized_emails then
    return;
  end if;

  delete from public.task_external_recipients where task_id = target_task_id;

  if task_row.assignee_type = 'external' then
    insert into public.task_external_recipients (task_id, email)
    select target_task_id, recipient.email from unnest(normalized_emails) as recipient(email);
  end if;
end;
$$;
