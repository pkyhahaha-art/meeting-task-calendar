-- Allow admins to read/select any avatar files in storage.objects so that upload with RETURNING and Admin avatar management succeed.
drop policy if exists member_avatar_files_read on storage.objects;

create policy member_avatar_files_read on storage.objects for select to authenticated
using (
  bucket_id = 'member-avatars'
  and public.is_active_user()
  and (
    name = auth.uid()::text || '/avatar.webp'
    or exists (select 1 from public.member_avatars a where a.storage_path = name)
    or public.is_admin()
  )
);
