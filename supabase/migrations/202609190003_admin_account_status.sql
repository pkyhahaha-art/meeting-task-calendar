-- Admin-only account status management. Password recovery remains self-service.
create or replace function public.admin_set_profile_status(target_user_id uuid, next_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_verified_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;
  if next_status not in ('active', 'disabled') then
    raise exception 'invalid account status';
  end if;
  if target_user_id = auth.uid() and next_status = 'disabled' then
    raise exception 'admin cannot disable their own account';
  end if;

  select email_verified_at into target_verified_at
  from public.profiles
  where id = target_user_id;

  if not found then
    raise exception 'account not found';
  end if;
  if next_status = 'active' and target_verified_at is null then
    raise exception 'email is not verified';
  end if;

  update public.profiles
  set status = next_status
  where id = target_user_id;
end;
$$;

revoke all on function public.admin_set_profile_status(uuid, text) from public, anon;
grant execute on function public.admin_set_profile_status(uuid, text) to authenticated;
