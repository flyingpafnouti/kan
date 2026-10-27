-- Run once in the Supabase SQL editor on an existing database.
-- Projects become shared between their members; notes stay private.
begin;

create table public.project_members (
  project_id uuid not null references public.projects on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

insert into public.project_members (project_id, user_id) select id, user_id from public.projects;

-- Secret of the invite link; null until the project is first shared.
alter table public.projects add column invite_token uuid unique;

-- Security definer so policies on projects and issues can check membership without recursing into RLS.
create function public.is_member(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members where project_id = pid and user_id = auth.uid())
$$;

create function public.add_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into project_members (project_id, user_id) values (new.id, new.user_id) on conflict do nothing;
  return new;
end $$;

create trigger projects_add_creator after insert on public.projects
for each row execute function public.add_creator();

create function public.join_project(token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  select id into pid from projects where invite_token = token;
  if pid is null then
    raise exception 'invalid invite' using errcode = 'P0002';
  end if;
  insert into project_members (project_id, user_id) values (pid, auth.uid()) on conflict do nothing;
  return pid;
end $$;

-- The last member to leave deletes the project; otherwise the creator role passes to the oldest member left.
create function public.leave_project(pid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from project_members where project_id = pid and user_id = auth.uid();
  if not found then
    return;
  end if;
  if not exists (select 1 from project_members where project_id = pid) then
    delete from projects where id = pid;
  else
    update projects
    set user_id = (select user_id from project_members where project_id = pid order by joined_at limit 1)
    where id = pid and user_id = auth.uid();
  end if;
end $$;

revoke execute on function public.join_project(uuid), public.leave_project(uuid) from public, anon;
grant execute on function public.join_project(uuid), public.leave_project(uuid) to authenticated;

alter table public.project_members enable row level security;

create policy "members of my projects" on public.project_members
  for select to authenticated
  using (public.is_member(project_id));

-- The creator check lets a new project pass RLS before the trigger has added its membership.
drop policy "own projects" on public.projects;
create policy "member projects" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_member(id))
  with check (user_id = (select auth.uid()) or public.is_member(id));

drop policy "own issues" on public.issues;
create policy "member issues" on public.issues
  for all to authenticated
  using (public.is_member(project_id))
  with check (public.is_member(project_id));

alter publication supabase_realtime add table public.project_members;

commit;
