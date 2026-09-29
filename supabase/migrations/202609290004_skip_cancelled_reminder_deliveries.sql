-- A delivery that was queued before its reminder was cancelled must not be
-- sent later by the notification worker.
update public.notification_deliveries delivery
  set status = 'skipped',
      next_attempt_at = null,
      error_code = 'reminder_cancelled',
      error_message = 'Reminder was cancelled before delivery.'
  from public.reminders reminder
  where delivery.reminder_id = reminder.id
    and reminder.status = 'cancelled'
    and delivery.status in ('queued', 'retry');

create or replace function public.cancel_stale_meeting_reminders()
returns integer
language sql
security definer
set search_path = ''
as $$
  with cancelled as (
    update public.reminders
      set status = 'cancelled'
      where status = 'scheduled'
        and scheduled_at < now() - interval '15 minutes'
      returning id
  ), skipped as (
    update public.notification_deliveries delivery
      set status = 'skipped',
          next_attempt_at = null,
          error_code = 'reminder_cancelled',
          error_message = 'Reminder was cancelled before delivery.'
      where delivery.reminder_id in (select id from cancelled)
        and delivery.status in ('queued', 'retry')
      returning id
  )
  select count(*)::integer from cancelled;
$$;

revoke all on function public.cancel_stale_meeting_reminders() from public;
grant execute on function public.cancel_stale_meeting_reminders() to service_role;
