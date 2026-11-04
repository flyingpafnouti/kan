-- Run once in the Supabase SQL editor on an existing database, before deploying the app that selects updated_by.
begin;

-- Who made the last change; null on rows changed before the column existed.
alter table public.issues
  add column if not exists updated_by uuid default auth.uid() references auth.users on delete set null;

create or replace function public.issues_updated_by() returns trigger
language plpgsql as $$
begin
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists issues_updated_by on public.issues;
create trigger issues_updated_by before insert or update on public.issues
for each row execute function public.issues_updated_by();

commit;
