-- Run once in the Supabase SQL editor on an existing database, before deploying the app that selects parent_id.
begin;

alter table public.issues
  add column if not exists parent_id uuid references public.issues on delete set null,
  add constraint issues_not_own_parent check (parent_id <> id);

create index if not exists issues_parent_idx on public.issues (parent_id) where parent_id is not null;

commit;
