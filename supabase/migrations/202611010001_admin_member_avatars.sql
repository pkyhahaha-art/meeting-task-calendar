-- Grant admins permission to manage member profile avatars in member_avatars and storage.
drop policy if exists member_avatars_insert on public.member_avatars;
drop policy if exists member_avatars_update on public.member_avatars;
drop policy if exists member_avatars_delete on public.member_avatars;

create policy member_avatars_insert on public.member_avatars for insert to authenticated
with check (public.is_active_user() and (user_id = auth.uid() or public.is_admin()));

create policy member_avatars_update on public.member_avatars for update to authenticated
using (public.is_active_user() and (user_id = auth.uid() or public.is_admin()))
with check (public.is_active_user() and (user_id = auth.uid() or public.is_admin()));

create policy member_avatars_delete on public.member_avatars for delete to authenticated
using (public.is_active_user() and (user_id = auth.uid() or public.is_admin()));

drop policy if exists member_avatar_files_insert on storage.objects;
drop policy if exists member_avatar_files_update on storage.objects;
drop policy if exists member_avatar_files_delete on storage.objects;

create policy member_avatar_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'member-avatars' and public.is_active_user() and (name = auth.uid()::text || '/avatar.webp' or public.is_admin()));

create policy member_avatar_files_update on storage.objects for update to authenticated
using (bucket_id = 'member-avatars' and public.is_active_user() and (name = auth.uid()::text || '/avatar.webp' or public.is_admin()))
with check (bucket_id = 'member-avatars' and public.is_active_user() and (name = auth.uid()::text || '/avatar.webp' or public.is_admin()));

create policy member_avatar_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'member-avatars' and public.is_active_user() and (name = auth.uid()::text || '/avatar.webp' or public.is_admin()));
