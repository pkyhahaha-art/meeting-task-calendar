-- Checklist audit: internal queue access, one-time pairing and common lookups.
begin;

-- This helper is invoked by owner-authorized SECURITY DEFINER RPCs/triggers,
-- never directly by the browser. Keep worker access without public enqueueing.
revoke all on function public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz) to service_role;

create or replace function public.verify_mobile_pairing_token(target_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.mobile_push_pairing_tokens token
    join public.profiles profile on profile.id=token.user_id and profile.status='active'
    where token.token=target_token and token.expires_at>now() and token.used_at is null) then
    return jsonb_build_object('valid',true);
  end if;
  return jsonb_build_object('valid',false,'error','QR Code ไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณาสร้าง QR Code ใหม่');
end;
$$;
revoke all on function public.verify_mobile_pairing_token(text) from public;
grant execute on function public.verify_mobile_pairing_token(text) to anon,authenticated;

create or replace function public.pair_mobile_device(target_token text,target_endpoint text,
  target_p256dh text,target_auth text,target_device_name text,target_user_agent text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token_record public.mobile_push_pairing_tokens; user_profile public.profiles;
  sub_id uuid; public_key bytea; auth_key bytea;
begin
  -- Use the same push providers allowed by the sender; refuse malformed keys.
  if target_endpoint is null or length(target_endpoint)>4096 or target_endpoint !~* '^https://(web[.]push[.]apple[.]com|fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|[a-z0-9-]+([.][a-z0-9-]+)*[.]notify[.]windows[.]com)(:443)?/[^[:space:]]+$'
    or target_p256dh is null or length(target_p256dh)>100 or target_auth is null or length(target_auth)>32 then
    return jsonb_build_object('success',false,'error','ข้อมูลการเชื่อมต่ออุปกรณ์ไม่ถูกต้อง กรุณาลองใหม่');
  end if;
  begin
    public_key:=decode(rpad(translate(target_p256dh,'-_','+/'),((length(target_p256dh)+3)/4)*4,'='),'base64');
    auth_key:=decode(rpad(translate(target_auth,'-_','+/'),((length(target_auth)+3)/4)*4,'='),'base64');
  exception when invalid_parameter_value then
    return jsonb_build_object('success',false,'error','ข้อมูลการเชื่อมต่ออุปกรณ์ไม่ถูกต้อง กรุณาลองใหม่');
  end;
  if octet_length(public_key)<>65 or octet_length(auth_key)<>16 then
    return jsonb_build_object('success',false,'error','ข้อมูลการเชื่อมต่ออุปกรณ์ไม่ถูกต้อง กรุณาลองใหม่');
  end if;
  if get_byte(public_key,0)<>4 then
    return jsonb_build_object('success',false,'error','ข้อมูลการเชื่อมต่ออุปกรณ์ไม่ถูกต้อง กรุณาลองใหม่');
  end if;

  -- Serialize concurrent scans. The second request sees used_at and is refused.
  select * into token_record from public.mobile_push_pairing_tokens
    where token=target_token and expires_at>now() and used_at is null for update;
  if not found then
    return jsonb_build_object('success',false,'error','Token ไม่ถูกต้อง หรือหมดอายุแล้ว');
  end if;
  select * into user_profile from public.profiles where id=token_record.user_id and status='active' for share;
  if not found then
    return jsonb_build_object('success',false,'error','บัญชีนี้ยังไม่ได้ยืนยันหรือถูกระงับ กรุณาติดต่อผู้ดูแลระบบ');
  end if;
  insert into public.mobile_push_subscriptions(user_id,endpoint,p256dh,auth,device_name,user_agent,last_used_at)
    values(token_record.user_id,target_endpoint,target_p256dh,target_auth,left(target_device_name,120),left(target_user_agent,2048),now())
    on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
      device_name=excluded.device_name,user_agent=excluded.user_agent,last_used_at=now()
    where public.mobile_push_subscriptions.auth=excluded.auth and public.mobile_push_subscriptions.p256dh=excluded.p256dh
    returning id into sub_id;
  if sub_id is null then
    return jsonb_build_object('success',false,'error','ข้อมูลการเชื่อมต่อไม่ตรงกับอุปกรณ์เดิม กรุณาเชื่อมต่อใหม่จากอุปกรณ์นี้');
  end if;
  update public.mobile_push_pairing_tokens set used_at=now(),device_info=left(target_device_name,120) where id=token_record.id;
  return jsonb_build_object('success',true,'subscription_id',sub_id,'user_name',user_profile.full_name,'employee_id',user_profile.employee_id);
end;
$$;
revoke all on function public.pair_mobile_device(text,text,text,text,text,text) from public;
grant execute on function public.pair_mobile_device(text,text,text,text,text,text) to anon,authenticated;

-- Existing identities, foreign keys, notification rules and data are unchanged.
create index if not exists attachments_event_idx on public.attachments(event_id);
create index if not exists task_attachments_task_idx on public.task_attachments(task_id);
create index if not exists notification_deliveries_event_created_idx on public.notification_deliveries(event_id,created_at desc) where event_id is not null;
create index if not exists notification_deliveries_task_created_idx on public.notification_deliveries(task_id,created_at desc) where task_id is not null;
notify pgrst,'reload schema';
commit;
