begin;

-- Add optional fields; legacy members and existing Task/Meeting text are untouched.
alter table public.profiles add column if not exists organization_unit text;
alter table public.profiles add column if not exists department text;

create or replace function public.valid_member_organization(unit text, department text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when unit is null then department is null
    when unit in ('ประจำฝ่าย (ฝลส.)','กกร.') then department is null
    when unit='กกก.' then department is not null and department in ('ผนผ.','ผวผ.','ผกก.','ผปล.')
    when unit='กบง.' then department is not null and department in ('ผสอ.','ผสส.','ผพส.','ผรส.','ผบร.')
    when unit='กคน.' then department is not null and department in ('ผคอ.','ผคส.','ผพค.','ผปก.')
    else false
  end;
$$;

alter table public.profiles add constraint profiles_organization_pair
  check (public.valid_member_organization(organization_unit,department));

-- Runs when the existing Auth lifecycle creates a profile, including missing-row
-- recovery at confirmation. Leave those Auth functions and triggers unchanged.
create or replace function public.set_new_member_organization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare metadata jsonb; unit text; selected_department text;
begin
  if new.organization_unit is null and new.department is null then
    select u.raw_user_meta_data into metadata from auth.users u where u.id=new.id;
    unit:=nullif(trim(metadata->>'organization_unit'),'');
    selected_department:=nullif(trim(metadata->>'department'),'');
    -- Unknown/missing legacy metadata must never prevent signup or confirmation.
    if public.valid_member_organization(unit,selected_department) then
      new.organization_unit:=unit;
      new.department:=selected_department;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.set_new_member_organization() from public,anon,authenticated;
create trigger profiles_new_organization before insert on public.profiles
  for each row execute function public.set_new_member_organization();

-- Existing own-profile RLS still controls these two non-sensitive fields.
grant update (organization_unit,department) on public.profiles to authenticated;

commit;
