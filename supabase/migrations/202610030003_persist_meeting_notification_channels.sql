begin;
alter table public.events add column if not exists email_notifications_enabled boolean;

-- Restore the Email choice from retained templates (including delivered/cancelled
-- reminders). With no templates, a creator confirmation is evidence of opt-in.
-- This changes saved settings only; it does not queue any messages.
update public.events e set email_notifications_enabled = case
  when exists(select 1 from public.reminders r where r.event_id=e.id and r.occurrence_id is null)
    then exists(select 1 from public.reminders r where r.event_id=e.id and r.occurrence_id is null and r.channel_email)
  else exists(select 1 from public.notification_deliveries d where d.event_id=e.id
    and d.channel='email' and d.recipient_type='owner' and d.template_key='meeting_created')
  end where e.email_notifications_enabled is null;
alter table public.events alter column email_notifications_enabled set default false;
alter table public.events alter column email_notifications_enabled set not null;
notify pgrst,'reload schema';
commit;
