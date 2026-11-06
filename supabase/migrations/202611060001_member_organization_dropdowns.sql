begin;

-- Keep the existing columns, constraint, signup trigger and stored data intact.
-- Accept the new dependent dropdown pairs alongside every previously valid pair.
create or replace function public.valid_member_organization(unit text, department text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when unit is null then department is null
    when unit in ('ฝลส.','ประจำฝ่าย (ฝลส.)','กกร.','กกร. (Team-Based)',
      'ประจำกอง (กบง.)','ประจำกอง (กคน.)','ประจำกอง (กกท.)') then department is null
    when unit in ('กกท.','กกก.') then department is null or department in
      ('ประจำกอง กกท.','ผนผ.','ผวผ.','ผกก.','ผปส.','ผปล.','อื่นๆ')
    when unit='กบง.' then department is null or department in
      ('ประจำกอง กบง.','ผสอ.','ผสส.','ผพส.','ผรส.','ผบธ.','ผบร.','อื่นๆ')
    when unit='กคน.' then department is null or department in
      ('ประจำกอง กคน.','ผคอ.','ผคส.','ผพค.','ผปก.','อื่นๆ')
    else false
  end;
$$;

commit;
