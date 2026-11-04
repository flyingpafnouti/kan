-- Run once in the Supabase SQL editor on an existing database, before deploying the app that draws in notes.
-- A drawing is a note image with its editable source beside it: <user id>/<uuid>.json.gz.
begin;

update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg', 'application/gzip']
where id = 'note-images';

commit;
