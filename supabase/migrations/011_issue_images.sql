-- Run once in the Supabase SQL editor on an existing database, before deploying the app that adds images to issues.
-- Images of the issues: in the note-images bucket, under the project's folder (<project id>/<file>),
-- so that every member of the project can see them and add some.
begin;

-- By text: a folder is a user id or a project id, and a cast to uuid must not fail on anything else.
create function public.is_member_folder(folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members where project_id::text = folder and user_id = auth.uid())
$$;

create policy "read project images" on storage.objects
  for select to authenticated
  using (bucket_id = 'note-images' and public.is_member_folder((storage.foldername(name))[1]));

create policy "add project images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-images' and public.is_member_folder((storage.foldername(name))[1]));

commit;
