-- Run once in the Supabase SQL editor.

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  position   float8 not null default 0,
  created_at timestamptz not null default now()
);

create table public.issues (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  title      text not null check (char_length(title) between 1 and 500),
  body       text not null default '',
  status     text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  position   float8 not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issues_project_idx on public.issues (project_id, status, position);
create index projects_user_idx on public.projects (user_id, position);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger issues_touch before update on public.issues
for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;
alter table public.issues   enable row level security;

create policy "own projects" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own issues" on public.issues
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

alter publication supabase_realtime add table public.projects, public.issues;
