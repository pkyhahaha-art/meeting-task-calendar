-- The existing mobile checkbox is stored in channel_line. Queue one push
-- delivery per subscribed device while preserving existing LINE delivery.
BEGIN;
ALTER TABLE public.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE public.notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('email', 'line', 'push'));
GRANT SELECT, UPDATE, DELETE ON public.mobile_push_subscriptions TO service_role;

CREATE OR REPLACE FUNCTION public.queue_push_reminder_delivery(
  target_reminder_id uuid, target_event_id uuid, target_task_id uuid,
  target_recipient_type text, target_user_id uuid, target_template text,
  target_payload jsonb, target_scheduled_at timestamptz
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notification_deliveries(
    reminder_id, task_reminder_id, event_id, task_id, recipient_type,
    recipient_reference, channel, idempotency_key, scheduled_at, template_key, payload
  )
  SELECT CASE WHEN target_task_id IS NULL THEN target_reminder_id ELSE NULL END,
    CASE WHEN target_task_id IS NOT NULL THEN target_reminder_id ELSE NULL END,
    target_event_id, target_task_id, target_recipient_type, device.id::text, 'push',
    concat('push-reminder:', target_reminder_id, ':', device.id, ':',
      to_char(target_scheduled_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS')),
    target_scheduled_at, target_template,
    coalesce(target_payload, '{}'::jsonb) || jsonb_build_object('push_user_id', target_user_id)
  FROM public.mobile_push_subscriptions device
  JOIN public.profiles profile ON profile.id = device.user_id AND profile.status = 'active'
  WHERE device.user_id = target_user_id AND device.endpoint LIKE 'https://%'
  ON CONFLICT (idempotency_key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.queue_push_reminder_delivery(uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_push_reminder_delivery(uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_due_line_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item record; member record; line_id text; queued integer := 0; message jsonb;
BEGIN
  FOR item IN
    SELECT r.*, e.owner_user_id, e.title, e.description,
      coalesce(occurrence.start_datetime, e.start_datetime) AS start_datetime,
      coalesce(occurrence.end_datetime, e.end_datetime) AS end_datetime,
      e.location, e.status AS entity_status, e.deleted_at,
      occurrence.status AS occurrence_status
    FROM public.reminders r JOIN public.events e ON e.id = r.event_id
    LEFT JOIN public.event_occurrences occurrence ON occurrence.id = r.occurrence_id
    WHERE r.status = 'scheduled' AND r.channel_line AND r.scheduled_at <= now()
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    IF item.entity_status <> 'scheduled' OR item.deleted_at IS NOT NULL OR item.occurrence_status = 'cancelled' THEN
      UPDATE public.reminders SET status = 'cancelled' WHERE id = item.id;
      CONTINUE;
    END IF;
    message := jsonb_build_object('entity', 'meeting', 'id', item.event_id,
      'occurrence_id', item.occurrence_id, 'title', item.title, 'description', item.description,
      'start_datetime', item.start_datetime, 'end_datetime', item.end_datetime, 'location', item.location);
    PERFORM public.queue_push_reminder_delivery(item.id, item.event_id, NULL, 'owner', item.owner_user_id, 'meeting_reminder', message, item.scheduled_at);
    SELECT line_user_id INTO line_id FROM public.line_connections WHERE user_id = item.owner_user_id AND disconnected_at IS NULL;
    PERFORM public.queue_line_delivery(item.id, item.event_id, NULL, 'owner', line_id, 'meeting_reminder', message, item.scheduled_at);
    IF NOT item.channel_email THEN UPDATE public.reminders SET status = 'completed' WHERE id = item.id; END IF;
    queued := queued + 1;
  END LOOP;

  FOR item IN
    SELECT r.*, t.creator_user_id, t.title, t.description, t.due_date, t.due_time,
      t.status AS entity_status, t.deleted_at
    FROM public.task_reminders r JOIN public.tasks t ON t.id = r.task_id
    WHERE r.status = 'scheduled' AND r.channel_line AND r.scheduled_at <= now()
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    IF item.entity_status <> 'pending' OR item.deleted_at IS NOT NULL THEN
      UPDATE public.task_reminders SET status = 'cancelled' WHERE id = item.id;
      CONTINUE;
    END IF;
    message := jsonb_build_object('entity', 'task', 'id', item.task_id, 'title', item.title,
      'description', item.description, 'due_date', item.due_date, 'due_time', item.due_time);
    FOR member IN SELECT profile.id FROM public.task_internal_recipients tir
      JOIN public.profiles profile ON profile.id = tir.user_id
      WHERE tir.task_id = item.task_id AND profile.status = 'active'
    LOOP
      PERFORM public.queue_push_reminder_delivery(item.id, NULL, item.task_id, 'task_assignee', member.id, 'task_reminder', message, item.scheduled_at);
      SELECT line_user_id INTO line_id FROM public.line_connections WHERE user_id = member.id AND disconnected_at IS NULL;
      PERFORM public.queue_line_delivery(item.id, NULL, item.task_id, 'task_assignee', line_id, 'task_reminder', message, item.scheduled_at);
    END LOOP;
    IF item.reminder_key = 'overdue' THEN
      PERFORM public.queue_push_reminder_delivery(item.id, NULL, item.task_id, 'task_creator', item.creator_user_id, 'task_reminder', message, item.scheduled_at);
      SELECT line_user_id INTO line_id FROM public.line_connections WHERE user_id = item.creator_user_id AND disconnected_at IS NULL;
      PERFORM public.queue_line_delivery(item.id, NULL, item.task_id, 'task_creator', line_id, 'task_reminder', message, item.scheduled_at);
    END IF;
    IF NOT item.channel_email THEN UPDATE public.task_reminders SET status = 'completed' WHERE id = item.id; END IF;
    queued := queued + 1;
  END LOOP;
  RETURN queued;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_due_line_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_due_line_reminders() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
