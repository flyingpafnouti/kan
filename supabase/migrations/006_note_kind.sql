-- Run once in the Supabase SQL editor on an existing database, before deploying the app that reads this column.
-- Pro or personal note: existing notes become pro.
alter table public.notes add column kind text not null default 'pro' check (kind in ('pro', 'perso'));
