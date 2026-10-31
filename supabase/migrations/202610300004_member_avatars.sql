-- Additive member pictures; existing profiles and event permissions are unchanged.
create table public.member_avatars (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  storage_path text not null,
  updated_at timestamptz not null default now(),
  constraint member_avatar_own_path check (storage_path = user_id::text || '/avatar.webp')
);
alter table public.member_avatars enable row level security;
grant select, insert, update, delete on public.member_avatars to authenticated;
create policy member_avatars_read on public.member_avatars for select to authenticated
  using (public.is_active_user() and exists (select 1 from public.profiles p where p.id = user_id and p.status = 'active'));
create policy member_avatars_insert on public.member_avatars for insert to authenticated with check (public.is_active_user() and user_id = auth.uid());
create policy member_avatars_update on public.member_avatars for update to authenticated using (public.is_active_user() and user_id = auth.uid()) with check (public.is_active_user() and user_id = auth.uid());
create policy member_avatars_delete on public.member_avatars for delete to authenticated using (public.is_active_user() and user_id = auth.uid());
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('member-avatars', 'member-avatars', false, 524288, array['image/webp']);
create policy member_avatar_files_read on storage.objects for select to authenticated
using (bucket_id = 'member-avatars' and public.is_active_user() and (name = auth.uid()::text || '/avatar.webp' or exists (select 1 from public.member_avatars a where a.storage_path = name)));
create policy member_avatar_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'member-avatars' and public.is_active_user() and name = auth.uid()::text || '/avatar.webp');
create policy member_avatar_files_update on storage.objects for update to authenticated
using (bucket_id = 'member-avatars' and public.is_active_user() and name = auth.uid()::text || '/avatar.webp')
with check (bucket_id = 'member-avatars' and public.is_active_user() and name = auth.uid()::text || '/avatar.webp');
create policy member_avatar_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'member-avatars' and public.is_active_user() and name = auth.uid()::text || '/avatar.webp');
