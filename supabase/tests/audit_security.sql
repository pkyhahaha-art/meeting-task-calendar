-- Synthetic users/devices and notification jobs are invisible to workers and
-- rolled back. No real account or connected phone is modified; nothing is sent.
begin;
do $$
<<audit_security>>
declare user_id uuid:=gen_random_uuid(); inactive_id uuid:=gen_random_uuid();
  token text:=gen_random_uuid()::text; disabled_token text:=gen_random_uuid()::text;
  public_key text:=replace(encode(decode('04'||repeat('01',64),'hex'),'base64'),chr(10),'');
  secret text:=encode(decode(repeat('02',16),'hex'),'base64');
  endpoint text:='https://web.push.apple.com/rollback-audit-'||gen_random_uuid()::text;
  result jsonb; meeting_id uuid;
begin
  if has_function_privilege('anon','public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz)','execute')
    or has_function_privilege('authenticated','public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz)','execute') then
    raise exception 'Client can call internal notification helper';
  end if;
  if not has_function_privilege('service_role','public.queue_notification(uuid,uuid,text,text,text,jsonb,timestamptz)','execute') then
    raise exception 'Worker lost internal notification helper';
  end if;
  insert into auth.users(id,email,raw_user_meta_data) values
    (user_id,'rollback-audit-'||user_id||'@gmail.com','{"full_name":"Audit Active User"}'),
    (inactive_id,'rollback-audit-'||inactive_id||'@gmail.com','{"full_name":"Audit Inactive User"}');
  update public.profiles set status='active' where id=user_id;
  update public.profiles set status='disabled' where id=inactive_id;
  insert into public.mobile_push_pairing_tokens(user_id,token,expires_at) values
    (user_id,token,now()+interval '10 minutes'),(inactive_id,disabled_token,now()+interval '10 minutes');
  if (public.verify_mobile_pairing_token(disabled_token)->>'valid')::boolean then raise exception 'Inactive pairing token is valid'; end if;
  result:=public.pair_mobile_device(disabled_token,endpoint,public_key,secret,'Fixture','Fixture');
  if (result->>'success')::boolean then raise exception 'Inactive account can pair'; end if;
  result:=public.pair_mobile_device(token,'https://example.com/arbitrary',public_key,secret,'Fixture','Fixture');
  if (result->>'success')::boolean then raise exception 'Arbitrary push URL accepted'; end if;
  result:=public.pair_mobile_device(token,endpoint,'bad','bad','Fixture','Fixture');
  if (result->>'success')::boolean then raise exception 'Malformed push keys accepted'; end if;
  result:=public.pair_mobile_device(token,endpoint,public_key,secret,'Fixture','Fixture');
  if not (result->>'success')::boolean then raise exception 'Valid pairing failed: %',result; end if;
  if (public.verify_mobile_pairing_token(token)->>'valid')::boolean then raise exception 'Consumed token still valid'; end if;
  result:=public.pair_mobile_device(token,endpoint||'-second',public_key,secret,'Fixture','Fixture');
  if (result->>'success')::boolean then raise exception 'One-time token was reused'; end if;
  if (select count(*) from public.mobile_push_subscriptions s where s.user_id=audit_security.user_id)<>1 then
    raise exception 'Unexpected subscriptions created';
  end if;
  token:=gen_random_uuid()::text;
  insert into public.mobile_push_pairing_tokens(user_id,token,expires_at)
    values(user_id,token,now()+interval '10 minutes');
  result:=public.pair_mobile_device(token,endpoint,public_key,encode(decode(repeat('03',16),'hex'),'base64'),'Fixture','Fixture');
  if (result->>'success')::boolean then raise exception 'Existing endpoint overwritten without matching keys'; end if;
  result:=public.pair_mobile_device(token,endpoint,public_key,secret,'Fixture re-paired','Fixture');
  if not (result->>'success')::boolean then raise exception 'Same device cannot re-pair: %',result; end if;
  perform set_config('request.jwt.claim.sub',user_id::text,true);
  insert into public.events(owner_user_id,title,start_datetime,suppress_guest_notifications)
    values(user_id,'Audit confirmation rollback',now()+interval '3 days',true) returning id into meeting_id;
  -- Run as the actual client role: authorized RPC can still call the helper.
  set local role authenticated;
  perform public.queue_creation_confirmation(meeting_id,null);
  reset role;
  if (select count(*) from public.notification_deliveries where event_id=meeting_id and template_key='meeting_created')<>1 then
    raise exception 'Authorized creator confirmation failed';
  end if;
end;
$$;
select 'PASS: internal queue isolated; active one-time pairing; endpoint/key validation; creator confirmation preserved' as result;
rollback;
