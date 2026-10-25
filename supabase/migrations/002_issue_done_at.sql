-- Run once in the Supabase SQL editor on an existing database.
begin;

alter table public.issues add column if not exists done_at timestamptz;

-- Best guess for issues already done; issues_touch is paused so updated_at keeps its value.
alter table public.issues disable trigger issues_touch;
update public.issues set done_at = updated_at where status = 'done' and done_at is null;
alter table public.issues enable trigger issues_touch;

create or replace function public.set_done_at() returns trigger
language plpgsql as $$
begin
  if new.status <> 'done' then
    new.done_at = null;
  elsif new.done_at is null then
    new.done_at = now();
  end if;
  return new;
end $$;

create trigger issues_done_at before insert or update on public.issues
for each row execute function public.set_done_at();

commit;
