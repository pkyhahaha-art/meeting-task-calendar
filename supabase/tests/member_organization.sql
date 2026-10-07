-- Synthetic Auth members only; rollback prevents confirmation emails/real changes.
begin;
do $$
declare legacy_id uuid:=gen_random_uuid(); new_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  legacy_gkg_id uuid:=gen_random_uuid(); invalid_id uuid:=gen_random_uuid(); unknown_id uuid:=gen_random_uuid(); signup_id uuid;
  recovery_id uuid:=gen_random_uuid(); disabled_id uuid:=gen_random_uuid();
  fixture record; member public.profiles; selected_department text; old_task uuid; old_event uuid; rows_changed integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (legacy_id,'rollback-'||legacy_id||'@gmail.com','{"full_name":"Legacy Member","employee_id":"987601"}'),
    (new_id,'rollback-'||new_id||'@gmail.com','{"full_name":"New Member","employee_id":"987602","organization_unit":"กคน.","department":"ผคอ."}'),
    (other_id,'rollback-'||other_id||'@gmail.com','{"full_name":"Other Member","organization_unit":"กกร.","department":null}'),
    (legacy_gkg_id,'rollback-'||legacy_gkg_id||'@gmail.com','{"full_name":"Legacy Division Member","organization_unit":"กกก.","department":"ผนผ."}'),
    (invalid_id,'rollback-'||invalid_id||'@gmail.com','{"full_name":"Invalid Metadata","organization_unit":"กคน.","department":"ผสอ."}'),
    (unknown_id,'rollback-'||unknown_id||'@gmail.com','{"full_name":"Unknown Metadata","organization_unit":"Unknown Unit","department":"Unknown Department"}'),
    (recovery_id,'rollback-'||recovery_id||'@gmail.com','{"full_name":"Recovery Member","organization_unit":"ประจำกอง (กคน.)","department":null}'),
    (disabled_id,'rollback-'||disabled_id||'@gmail.com','{"full_name":"Disabled Member","organization_unit":"กกท.","department":null}');
  select * into member from public.profiles where id=legacy_id;
  if member.organization_unit is not null or member.department is not null or member.status<>'pending_verification'
    or member.employee_id is not null then raise exception 'Legacy lifecycle changed'; end if;
  select * into member from public.profiles where id=new_id;
  if member.organization_unit<>'กคน.' or member.department<>'ผคอ.' or member.status<>'pending_verification'
    or member.role<>'user' then raise exception 'Signup metadata was not saved correctly'; end if;
  if exists(select 1 from public.profiles where id in(invalid_id,unknown_id) and (organization_unit is not null or department is not null))
    then raise exception 'Invalid legacy metadata blocked or polluted signup'; end if;
  if not exists(select 1 from public.profiles where id=legacy_gkg_id and organization_unit='กกก.' and department='ผนผ.')
    or not exists(select 1 from public.profiles where id=other_id and organization_unit='กกร.' and department is null)
    then raise exception 'Legacy labels changed during signup'; end if;

  -- Exercise the existing missing-profile confirmation recovery using only a
  -- synthetic profile, and ensure confirmation never reactivates a disabled one.
  delete from public.profiles where id=recovery_id;
  update public.profiles set status='disabled' where id=disabled_id;
  update auth.users set email_confirmed_at=now() where id in(legacy_id,new_id,other_id,legacy_gkg_id,invalid_id,unknown_id,recovery_id,disabled_id);
  select * into member from public.profiles where id=new_id;
  if member.status<>'active' or member.employee_id<>'987602' or member.organization_unit<>'กคน.' or member.department<>'ผคอ.'
    then raise exception 'Confirmation lost profile or organization'; end if;
  if not exists(select 1 from public.profiles where id=legacy_id and status='active' and employee_id='987601' and organization_unit is null)
    then raise exception 'Legacy confirmation no longer works'; end if;
  if not exists(select 1 from public.profiles where id=legacy_gkg_id and status='active' and organization_unit='กกก.' and department='ผนผ.')
    or not exists(select 1 from public.profiles where id=other_id and status='active' and organization_unit='กกร.' and department is null)
    or exists(select 1 from public.profiles where id in(invalid_id,unknown_id) and (status<>'active' or organization_unit is not null or department is not null))
    then raise exception 'Legacy/unknown metadata confirmation changed existing behavior'; end if;
  if not exists(select 1 from public.profiles where id=recovery_id and status='active' and organization_unit='ประจำกอง (กคน.)' and department is null)
    or not exists(select 1 from public.profiles where id=disabled_id and status='disabled' and organization_unit='กกท.' and department is null)
    then raise exception 'Missing-profile recovery or disabled-account confirmation regressed'; end if;

  -- New canonical choices pass through the unchanged Auth metadata/profile
  -- triggers, including the optional (NULL) department on all three divisions.
  for fixture in select * from (values
    ('ประจำฝ่าย (ฝลส.)',null::text),('กกท.',null),('กบง.',null),('กคน.',null),
    ('กกร. (Team-Based)',null),('ประจำกอง (กบง.)',null),('ประจำกอง (กคน.)',null),('ประจำกอง (กกท.)',null),
    ('กกท.','ผปล.'),('กบง.','ผสอ.'),('กคน.','ผคอ.')) pairs(unit,department)
  loop
    signup_id:=gen_random_uuid();
    insert into auth.users(id,email,raw_user_meta_data) values(signup_id,'rollback-'||signup_id||'@gmail.com',
      jsonb_build_object('full_name','New Organization Member','organization_unit',fixture.unit,'department',fixture.department));
    select * into member from public.profiles where id=signup_id;
    if member.organization_unit is distinct from fixture.unit or member.department is distinct from fixture.department
      or member.status<>'pending_verification' or member.role<>'user' then raise exception 'New organization signup metadata mismatch: %',fixture; end if;
    update auth.users set email_confirmed_at=now() where id=signup_id;
    select * into member from public.profiles where id=signup_id;
    if member.organization_unit is distinct from fixture.unit or member.department is distinct from fixture.department
      or member.status<>'active' or member.role<>'user' then raise exception 'New organization confirmation mismatch: %',fixture; end if;
  end loop;

  for fixture in select * from (values
    ('กกก.',array[null::text,'ผนผ.','ผวผ.','ผกก.','ผปล.']),
    ('กกท.',array[null::text,'ผนผ.','ผวผ.','ผกก.','ผปล.']),
    ('กบง.',array[null::text,'ผสอ.','ผสส.','ผพส.','ผรส.','ผบร.']),
    ('กคน.',array[null::text,'ผคอ.','ผคส.','ผพค.','ผปก.']),
    ('กกร.',array[null::text]),('กกร. (Team-Based)',array[null::text]),('ประจำฝ่าย (ฝลส.)',array[null::text]),
    ('ประจำกอง (กบง.)',array[null::text]),('ประจำกอง (กคน.)',array[null::text]),('ประจำกอง (กกท.)',array[null::text])) pairs(unit,departments)
  loop
    foreach selected_department in array fixture.departments loop
      update public.profiles set organization_unit=fixture.unit,department=selected_department where id=new_id;
    end loop;
  end loop;
  begin
    update public.profiles set organization_unit='กคน.',department='ผสอ.' where id=new_id;
    raise exception 'Mismatched department allowed';
  exception when check_violation then null; end;
  for fixture in select * from (values
    ('กกท.','ผคอ.'),('กกก.','ผสอ.'),('กบง.','ผปล.'),('กคน.','ผสอ.'),
    ('กกร.','ผคอ.'),('กกร. (Team-Based)','ผคอ.'),('ประจำฝ่าย (ฝลส.)','ผนผ.'),
    ('ประจำกอง (กบง.)','ผสอ.'),('ประจำกอง (กคน.)','ผคอ.'),('ประจำกอง (กกท.)','ผนผ.'),
    ('กกท.',''),('กบง.',''),('กคน.',''),('กกร. (Team-Based)',''),
    ('Unknown Unit',null::text),('',null::text),(null::text,'ผคอ.')) pairs(unit,department)
  loop
    if public.valid_member_organization(fixture.unit,fixture.department) is distinct from false then
      raise exception 'Invalid organization pair accepted by validator: %',fixture;
    end if;
    begin
      update public.profiles set organization_unit=fixture.unit,department=fixture.department where id=new_id;
      raise exception 'Invalid organization pair accepted by profile constraint: %',fixture;
    exception when check_violation then null; end;
  end loop;

  perform set_config('request.jwt.claim.sub',legacy_id::text,true);
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,affiliation,due_date)
    values(legacy_id,'internal',legacy_id,'Legacy organization task','Saved legacy Task text',current_date+5) returning id into old_task;
  insert into public.events(owner_user_id,title,affiliation,start_datetime)
    values(legacy_id,'Legacy organization meeting','Saved legacy Meeting text',now()+interval '5 days') returning id into old_event;
  set local role authenticated;
  update public.profiles set organization_unit='กกท.',department=null where id=legacy_id;
  get diagnostics rows_changed=row_count;
  if rows_changed<>1 then raise exception 'Active member cannot update own organization'; end if;
  update public.profiles set organization_unit='กกร. (Team-Based)',department=null where id=legacy_id;
  get diagnostics rows_changed=row_count;
  if rows_changed<>1 then raise exception 'Active member cannot select new departmentless unit'; end if;
  update public.profiles set organization_unit='กกร. (Team-Based)',department=null where id=other_id;
  get diagnostics rows_changed=row_count;
  if rows_changed<>0 then raise exception 'Organization update bypasses own-profile RLS'; end if;
  begin
    update public.profiles set role='admin' where id=legacy_id;
    raise exception 'New fields granted role escalation';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub',disabled_id::text,true);
  set local role authenticated;
  update public.profiles set organization_unit='กบง.',department=null where id=disabled_id;
  get diagnostics rows_changed=row_count;
  if rows_changed<>0 then raise exception 'Disabled member organization update bypasses active-account RLS'; end if;
  reset role;
  if not exists(select 1 from public.profiles where id=legacy_gkg_id and organization_unit='กกก.' and department='ผนผ.')
    or not exists(select 1 from public.profiles where id=other_id and organization_unit='กกร.' and department is null)
    then raise exception 'Editing another member rewrote stored legacy labels'; end if;
  if not exists(select 1 from public.tasks where id=old_task and affiliation='Saved legacy Task text')
    or not exists(select 1 from public.events where id=old_event and affiliation='Saved legacy Meeting text')
    then raise exception 'Updating profile changed existing items'; end if;
end;
$$;
select 'PASS: new/legacy member organizations, optional and departmentless NULL validation, unchanged Auth lifecycle, calendar data and own-profile RLS' as result;
rollback;
