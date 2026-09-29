-- A recurring Meeting has one base reminder template per offset. Occurrence
-- reminders are generated from that template and must not feed back into the
-- edit form as additional selected reminder options.
with duplicate_templates as (
  select
    event_id,
    offset_value,
    offset_unit,
    (array_agg(id order by created_at, id))[1] as keep_id,
    bool_or(channel_email) as channel_email,
    bool_or(channel_line) as channel_line
  from public.reminders
  where occurrence_id is null
  group by event_id, offset_value, offset_unit
  having count(*) > 1
)
update public.reminders reminder
set
  channel_email = duplicate_templates.channel_email,
  channel_line = duplicate_templates.channel_line,
  updated_at = now()
from duplicate_templates
where reminder.id = duplicate_templates.keep_id;

with duplicate_templates as (
  select
    event_id,
    offset_value,
    offset_unit,
    (array_agg(id order by created_at, id))[1] as keep_id
  from public.reminders
  where occurrence_id is null
  group by event_id, offset_value, offset_unit
  having count(*) > 1
)
delete from public.reminders reminder
using duplicate_templates
where reminder.event_id = duplicate_templates.event_id
  and reminder.occurrence_id is null
  and reminder.offset_value = duplicate_templates.offset_value
  and reminder.offset_unit = duplicate_templates.offset_unit
  and reminder.id <> duplicate_templates.keep_id;

create unique index if not exists base_meeting_reminder_unique
  on public.reminders(event_id, offset_value, offset_unit)
  where occurrence_id is null;
