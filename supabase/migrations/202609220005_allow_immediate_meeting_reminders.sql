-- Allow the Meeting reminder option "ทันที" (0 minutes before start).
alter table public.reminders
  drop constraint if exists reminders_offset_value_check;

alter table public.reminders
  add constraint reminders_offset_value_check check (offset_value >= 0);
