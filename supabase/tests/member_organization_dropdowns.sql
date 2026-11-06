-- Synthetic validation only: this transaction does not change member/calendar data.
begin;
do $$
declare pair record; member_id uuid; saved public.profiles;
begin
  for pair in select * from (values
    ('ฝลส.',null::text), ('กกร.',null),
    ('กกท.','ประจำกอง กกท.'),('กกท.','ผนผ.'),('กกท.','ผวผ.'),('กกท.','ผกก.'),('กกท.','ผปส.'),('กกท.','อื่นๆ'),
    ('กบง.','ประจำกอง กบง.'),('กบง.','ผสอ.'),('กบง.','ผสส.'),('กบง.','ผพส.'),('กบง.','ผรส.'),('กบง.','ผบธ.'),('กบง.','อื่นๆ'),
    ('กคน.','ประจำกอง กคน.'),('กคน.','ผคอ.'),('กคน.','ผคส.'),('กคน.','ผพค.'),('กคน.','ผปก.'),('กคน.','อื่นๆ'),
    (null,null),('ประจำฝ่าย (ฝลส.)',null),('กกร. (Team-Based)',null),
    ('ประจำกอง (กบง.)',null),('ประจำกอง (กคน.)',null),('ประจำกอง (กกท.)',null),
    ('กกก.','ผปล.'),('กกท.','ผปล.'),('กบง.','ผบร.'),('กกท.',null),('กบง.',null),('กคน.',null)
  ) choices(unit,department) loop
    if public.valid_member_organization(pair.unit,pair.department) is distinct from true then
      raise exception 'Expected valid organization pair: %, %',pair.unit,pair.department;
    end if;
  end loop;
  -- Exercise the unchanged signup metadata/profile trigger with new pairs.
  for pair in select * from (values
    ('ฝลส.',null::text),('กกร.',null),('กกท.','ผปส.'),('กบง.','ผบธ.'),
    ('กคน.','ประจำกอง กคน.'),('กบง.','อื่นๆ')
  ) choices(unit,department) loop
    member_id:=gen_random_uuid();
    insert into auth.users(id,email,raw_user_meta_data)
      values(member_id,'org-dropdown-'||member_id::text||'@gmail.com',
        jsonb_build_object('full_name','Organization dropdown fixture',
          'organization_unit',pair.unit,'department',pair.department));
    select * into saved from public.profiles where id=member_id;
    if saved.organization_unit is distinct from pair.unit or saved.department is distinct from pair.department
      or saved.status<>'pending_verification' or saved.role<>'user' then
      raise exception 'New signup metadata mismatch: %, %',pair.unit,pair.department;
    end if;
    update auth.users set email_confirmed_at=now() where id=member_id;
    select * into saved from public.profiles where id=member_id;
    if saved.organization_unit is distinct from pair.unit or saved.department is distinct from pair.department
      or saved.status<>'active' or saved.role<>'user' then
      raise exception 'New confirmation metadata mismatch: %, %',pair.unit,pair.department;
    end if;
  end loop;
  for pair in select * from (values
    ('ฝลส.','ผนผ.'),('กกร.','อื่นๆ'),('กกท.','ผคอ.'),('กบง.','ผนผ.'),
    ('กคน.','ประจำกอง กบง.'),('unknown',null::text),(null,'ผนผ.')
  ) choices(unit,department) loop
    if public.valid_member_organization(pair.unit,pair.department) is distinct from false then
      raise exception 'Expected invalid organization pair: %, %',pair.unit,pair.department;
    end if;
  end loop;
end;
$$;
rollback;
