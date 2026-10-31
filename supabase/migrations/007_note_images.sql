-- Run once in the Supabase SQL editor on an existing database, before deploying the app that uses this bucket.
-- Images of the notes: private, each user reaches only their own folder (<user id>/<file>).
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-images', 'note-images', false, 2097152, array['image/webp', 'image/jpeg']);

create policy "read own note images" on storage.objects
  for select to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "add own note images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
