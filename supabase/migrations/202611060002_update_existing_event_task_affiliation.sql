begin;

-- Function to derive creator affiliation matching public.valid_member_organization and profileAffiliation
create or replace function public.derive_profile_affiliation(unit text, dept text)
returns text language sql immutable set search_path = '' as $$
  select case
    when unit is null or unit = '' then ''
    when unit in ('ประจำฝ่าย (ฝลส.)', 'ฝลส.') then 'ฝลส.'
    when unit in ('กกร.', 'กกร. (Team-Based)') then 'กกร.'
    when unit in ('กกท.', 'กกก.', 'กบง.', 'กคน.') then
      case
        when dept is null or dept = '' or dept = 'อื่นๆ' or dept = 'ไม่ระบุ' or dept like 'ประจำกอง %' then
          case when unit = 'กกก.' then 'กกท.' else unit end
        else
          (case when unit = 'กกก.' and dept = 'ผปล.' then 'ผปส.'
                when unit = 'กบง.' and dept = 'ผบร.' then 'ผบธ.'
                else dept end) || ' ' || (case when unit = 'กกก.' then 'กกท.' else unit end)
      end
    else coalesce(unit, '')
  end;
$$;

-- Update existing events from creator's profile
update public.events e
set affiliation = public.derive_profile_affiliation(p.organization_unit, p.department)
from public.profiles p
where e.owner_user_id = p.id
  and public.derive_profile_affiliation(p.organization_unit, p.department) <> '';

-- Also strip legacy ' ฝลส.' suffix from any remaining events if profile wasn't found
update public.events
set affiliation = regexp_replace(affiliation, ' ฝลส\.$', '')
where affiliation like '% ฝลส.';

-- Update existing tasks from creator's profile
update public.tasks t
set affiliation = public.derive_profile_affiliation(p.organization_unit, p.department)
from public.profiles p
where t.creator_user_id = p.id
  and public.derive_profile_affiliation(p.organization_unit, p.department) <> '';

-- Also strip legacy ' ฝลส.' suffix from any remaining tasks if profile wasn't found
update public.tasks
set affiliation = regexp_replace(affiliation, ' ฝลส\.$', '')
where affiliation like '% ฝลส.';

commit;

