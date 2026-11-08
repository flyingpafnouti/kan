-- Run once in the Supabase SQL editor on an existing database.
-- Notes may hold up to 100 000 characters (was 20 000). Mirrored by NOTE_MAX_LENGTH in src/lib/types.ts.
begin;

alter table public.notes drop constraint notes_body_check;
alter table public.notes add constraint notes_body_check check (char_length(body) between 1 and 100000);

commit;
