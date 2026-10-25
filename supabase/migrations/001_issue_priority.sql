-- Run once in the Supabase SQL editor on an existing database.
alter table public.issues add column if not exists priority smallint check (priority between 0 and 3);
