-- PRD section 16: retry failed delivery after 5, 15, and 30 minutes.
-- `attempt` includes the initial send, therefore four total send attempts are
-- possible: the initial attempt plus three retries.
alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_attempt_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_attempt_check
  check (attempt between 0 and 4);

create or replace function public.requeue_stale_email_deliveries()
returns integer
language sql
security definer
set search_path = ''
as $$
  with recovered as (
    update public.notification_deliveries
    set status = case when attempt < 4 then 'retry' else 'failed' end,
      next_attempt_at = case when attempt < 4 then now() else null end,
      error_code = 'processing_timeout',
      error_message = 'Delivery worker did not finish within 20 minutes.'
    where channel = 'email'
      and status = 'processing'
      and updated_at < now() - interval '20 minutes'
    returning id
  )
  select count(*)::integer from recovered;
$$;

revoke all on function public.requeue_stale_email_deliveries() from public;
grant execute on function public.requeue_stale_email_deliveries() to service_role;
