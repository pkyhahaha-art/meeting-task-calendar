-- All fixtures roll back; no Email or Push is sent.
begin;
do $$
declare creator public.profiles; meeting_id uuid;
begin
  select * into creator from public.profiles where status='active' order by created_at limit 1;
  if creator.id is null then raise exception 'test requires an active profile'; end if;
  perform set_config('request.jwt.claim.sub',creator.id::text,true);
  insert into public.events(owner_user_id,title,start_datetime,suppress_guest_notifications)
    values(creator.id,'Notification settings rollback test',now()+interval '2 days',true) returning id into meeting_id;
  update public.events set email_notifications_enabled=true,mobile_notifications_enabled=true where id=meeting_id;
  if not exists(select 1 from public.events where id=meeting_id and email_notifications_enabled and mobile_notifications_enabled)
    then raise exception 'channels were lost without reminder rows'; end if;
  insert into public.reminders(event_id,offset_value,offset_unit,scheduled_at,channel_email,channel_line)
    values(meeting_id,0,'minute',now()+interval '2 days',true,true);
  update public.reminders set status='completed' where event_id=meeting_id;
  if not exists(select 1 from public.events where id=meeting_id and email_notifications_enabled and mobile_notifications_enabled)
    then raise exception 'delivery cleared chosen channels'; end if;
  update public.events set title='Edited meeting' where id=meeting_id;
  if not exists(select 1 from public.events where id=meeting_id and email_notifications_enabled and mobile_notifications_enabled)
    then raise exception 'unrelated edit cleared chosen channels'; end if;
  update public.events set email_notifications_enabled=false,mobile_notifications_enabled=false where id=meeting_id;
  if exists(select 1 from public.events where id=meeting_id and (email_notifications_enabled or mobile_notifications_enabled))
    then raise exception 'explicit opt-out was ignored'; end if;
end;
$$;
select 'PASS: channels survive no reminders, delivery completion and unrelated edits; explicit opt-out is retained' as result;
rollback;
