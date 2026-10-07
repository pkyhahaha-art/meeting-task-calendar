begin;

-- Extend the existing profile-pair validation only. Stored legacy labels,
-- membership/Auth lifecycle, table structure, policies and calendar text stay
-- untouched. The existing metadata trigger uses this validator at signup.
create or replace function public.valid_member_organization(unit text, department text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when unit is null then department is null
    when unit in ('ประจำฝ่าย (ฝลส.)','กกร.','กกร. (Team-Based)',
      'ประจำกอง (กบง.)','ประจำกอง (กคน.)','ประจำกอง (กกท.)') then department is null
    when unit in ('กกท.','กกก.') then department is null or department in ('ผนผ.','ผวผ.','ผกก.','ผปล.')
    when unit='กบง.' then department is null or department in ('ผสอ.','ผสส.','ผพส.','ผรส.','ผบร.')
    when unit='กคน.' then department is null or department in ('ผคอ.','ผคส.','ผพค.','ผปก.')
    else false
  end;
$$;

commit;
