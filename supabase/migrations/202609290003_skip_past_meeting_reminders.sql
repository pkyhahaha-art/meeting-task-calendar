-- Do not backfill a reminder whose calculated delivery time was already past
-- when its Meeting was saved or its occurrence was materialized.
create or replace function public.cancel_past_meeting_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'scheduled' and new.scheduled_at < now() then
    new.status := 'cancelled';
  end if;
  return new;
end;
$$;

drop trigger if exists reminders_cancel_past_delivery on public.reminders;
create trigger reminders_cancel_past_delivery
  before insert or update of scheduled_at, status on public.reminders
  for each row execute function public.cancel_past_meeting_reminder();

-- Clear stale records created before this rule was introduced. A small grace
-- window is applied by the worker for normal scheduler latency.
update public.reminders
  set status = 'cancelled'
  where status = 'scheduled' and scheduled_at < now();

create function public.cancel_stale_meeting_reminders()
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
  )
  select count(*)::integer from cancelled;
$$;

revoke all on function public.cancel_past_meeting_reminder() from public;
revoke all on function public.cancel_stale_meeting_reminders() from public;
grant execute on function public.cancel_stale_meeting_reminders() to service_role;
