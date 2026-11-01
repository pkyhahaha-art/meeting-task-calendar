begin;

-- Grant column update permissions so authenticated admins can modify employee profiles
grant update (full_name, employee_id, organization_unit, department) on public.profiles to authenticated;

-- Allow admins to update any profile via RLS
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Dedicated RPC function for admin updating a member profile with full validation and auditing
create or replace function public.admin_update_member_profile(
  target_user_id uuid,
  next_full_name text,
  next_employee_id text default null,
  next_organization_unit text default null,
  next_department text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_full_name text;
  cleaned_employee_id text;
  cleaned_unit text;
  cleaned_dept text;
  old_full_name text;
  old_employee_id text;
  old_unit text;
  old_dept text;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  cleaned_full_name := trim(next_full_name);
  if cleaned_full_name is null or char_length(cleaned_full_name) < 2 or char_length(cleaned_full_name) > 120 then
    raise exception 'full_name must be between 2 and 120 characters';
  end if;

  cleaned_employee_id := nullif(trim(next_employee_id), '');
  cleaned_unit := nullif(trim(next_organization_unit), '');
  cleaned_dept := nullif(trim(next_department), '');

  if not public.valid_member_organization(cleaned_unit, cleaned_dept) then
    raise exception 'invalid organization unit or department';
  end if;

  -- Ensure employee_id is unique if specified
  if cleaned_employee_id is not null and exists (
    select 1 from public.profiles
    where employee_id = cleaned_employee_id and id <> target_user_id
  ) then
    raise exception 'รหัสพนักงานนี้ถูกใช้งานแล้วในระบบ';
  end if;

  select full_name, employee_id, organization_unit, department
  into old_full_name, old_employee_id, old_unit, old_dept
  from public.profiles
  where id = target_user_id;

  if not found then
    raise exception 'account not found';
  end if;

  update public.profiles
  set
    full_name = cleaned_full_name,
    employee_id = cleaned_employee_id,
    organization_unit = cleaned_unit,
    department = cleaned_dept,
    updated_at = now()
  where id = target_user_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'admin_update_profile',
    'profile',
    target_user_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('full_name', old_full_name, 'employee_id', old_employee_id, 'organization_unit', old_unit, 'department', old_dept),
      'after', jsonb_build_object('full_name', cleaned_full_name, 'employee_id', cleaned_employee_id, 'organization_unit', cleaned_unit, 'department', cleaned_dept)
    )
  );
end;
$$;

revoke all on function public.admin_update_member_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_update_member_profile(uuid, text, text, text, text) to authenticated;

commit;

