-- Run once in the Supabase SQL editor on an existing database.
-- Last change to a project or its issues, so the Projects page can list the most recent first.
begin;

alter table public.projects add column updated_at timestamptz not null default now();

update public.projects p
set updated_at = greatest(p.created_at, coalesce((select max(i.updated_at) from public.issues i where i.project_id = p.id), p.created_at));

-- Renaming counts as a change; sharing the project (invite_token) does not.
create function public.projects_touch() returns trigger
language plpgsql as $$
begin
  if new.name is distinct from old.name then
    new.updated_at = now();
  end if;
  return new;
end $$;

create trigger projects_touch before update on public.projects
for each row execute function public.projects_touch();

create function public.touch_project() returns trigger
language plpgsql as $$
begin
  update public.projects set updated_at = now() where id = coalesce(new.project_id, old.project_id);
  return null;
end $$;

create trigger issues_touch_project after insert or update or delete on public.issues
for each row execute function public.touch_project();

commit;
