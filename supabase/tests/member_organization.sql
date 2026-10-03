-- Synthetic Auth members only; rollback prevents confirmation emails/real changes.
begin;
do $$
declare legacy_id uuid:=gen_random_uuid(); new_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  invalid_id uuid:=gen_random_uuid(); fixture record; member public.profiles; selected_department text; old_task uuid; old_event uuid; rows_changed integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (legacy_id,'rollback-'||legacy_id||'@gmail.com','{"full_name":"Legacy Member","employee_id":"987601"}'),
    (new_id,'rollback-'||new_id||'@gmail.com','{"full_name":"New Member","employee_id":"987602","organization_unit":"กคน.","department":"ผคอ."}'),
    (other_id,'rollback-'||other_id||'@gmail.com','{"full_name":"Other Member","organization_unit":"กกร.","department":null}'),
    (invalid_id,'rollback-'||invalid_id||'@gmail.com','{"full_name":"Invalid Metadata","organization_unit":"กคน.","department":"ผสอ."}');
  select * into member from public.profiles where id=legacy_id;
  if member.organization_unit is not null or member.department is not null or member.status<>'pending_verification'
    or member.employee_id is not null then raise exception 'Legacy lifecycle changed'; end if;
  select * into member from public.profiles where id=new_id;
  if member.organization_unit<>'กคน.' or member.department<>'ผคอ.' or member.status<>'pending_verification'
    or member.role<>'user' then raise exception 'Signup metadata was not saved correctly'; end if;
  if exists(select 1 from public.profiles where id=invalid_id and organization_unit is not null)
    then raise exception 'Invalid legacy metadata blocked or polluted signup'; end if;

  update auth.users set email_confirmed_at=now() where id in(legacy_id,new_id,other_id);
  select * into member from public.profiles where id=new_id;
  if member.status<>'active' or member.employee_id<>'987602' or member.organization_unit<>'กคน.' or member.department<>'ผคอ.'
    then raise exception 'Confirmation lost profile or organization'; end if;
  if not exists(select 1 from public.profiles where id=legacy_id and status='active' and employee_id='987601' and organization_unit is null)
    then raise exception 'Legacy confirmation no longer works'; end if;

  for fixture in select * from (values
    ('กกก.',array['ผนผ.','ผวผ.','ผกก.','ผปล.']),
    ('กบง.',array['ผสอ.','ผสส.','ผพส.','ผรส.','ผบร.']),
    ('กคน.',array['ผคอ.','ผคส.','ผพค.','ผปก.']),
    ('กกร.',array[null::text]),('ประจำฝ่าย (ฝลส.)',array[null::text])) pairs(unit,departments)
  loop
    foreach selected_department in array fixture.departments loop
      update public.profiles set organization_unit=fixture.unit,department=selected_department where id=new_id;
    end loop;
  end loop;
  begin
    update public.profiles set organization_unit='กคน.',department='ผสอ.' where id=new_id;
    raise exception 'Mismatched department allowed';
  exception when check_violation then null; end;
  begin
    update public.profiles set organization_unit='กกร.',department='ผคอ.' where id=new_id;
    raise exception 'Department allowed for departmentless unit';
  exception when check_violation then null; end;
  begin
    update public.profiles set organization_unit='กคน.',department=null where id=new_id;
    raise exception 'Required department missing';
  exception when check_violation then null; end;

  perform set_config('request.jwt.claim.sub',legacy_id::text,true);
  insert into public.tasks(creator_user_id,assignee_type,assignee_user_id,title,affiliation,due_date)
    values(legacy_id,'internal',legacy_id,'Legacy organization task','Saved legacy Task text',current_date+5) returning id into old_task;
  insert into public.events(owner_user_id,title,affiliation,start_datetime)
    values(legacy_id,'Legacy organization meeting','Saved legacy Meeting text',now()+interval '5 days') returning id into old_event;
  set local role authenticated;
  update public.profiles set organization_unit='กคน.',department='ผปก.' where id=legacy_id;
  get diagnostics rows_changed=row_count;
  if rows_changed<>1 then raise exception 'Active member cannot update own organization'; end if;
  update public.profiles set organization_unit='กกร.',department=null where id=other_id;
  get diagnostics rows_changed=row_count;
  if rows_changed<>0 then raise exception 'Organization update bypasses own-profile RLS'; end if;
  begin
    update public.profiles set role='admin' where id=legacy_id;
    raise exception 'New fields granted role escalation';
  exception when insufficient_privilege then null; end;
  reset role;
  if not exists(select 1 from public.tasks where id=old_task and affiliation='Saved legacy Task text')
    or not exists(select 1 from public.events where id=old_event and affiliation='Saved legacy Meeting text')
    then raise exception 'Updating profile changed existing items'; end if;
end;
$$;
select 'PASS: member organizations, Auth lifecycle, legacy data and own-profile RLS' as result;
rollback;
