-- Run once in the Supabase SQL editor.

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  position   float8 not null default 0,
  created_at timestamptz not null default now(),
  -- Last change to the project or its issues; the Projects page lists the most recent first.
  updated_at timestamptz not null default now(),
  -- Secret of the invite link; null until the project is first shared.
  invite_token uuid unique
);

create table public.project_members (
  project_id uuid not null references public.projects on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.issues (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  title      text not null check (char_length(title) between 1 and 500),
  body       text not null default '',
  status     text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority   smallint check (priority between 0 and 3),
  position   float8 not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set by issues_done_at when the issue enters "done", cleared when it leaves.
  done_at    timestamptz
);

-- Loose ideas, not tied to a project yet; one can be turned into an issue.
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  body       text not null check (char_length(body) between 1 and 20000),
  kind       text not null default 'pro' check (kind in ('pro', 'perso')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issues_project_idx on public.issues (project_id, status, position);
create index projects_user_idx on public.projects (user_id, position);
create index notes_user_idx on public.notes (user_id, created_at);
create index project_members_user_idx on public.project_members (user_id);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger issues_touch before update on public.issues
for each row execute function public.touch_updated_at();

create trigger notes_touch before update on public.notes
for each row execute function public.touch_updated_at();

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

create function public.set_done_at() returns trigger
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

-- True for unflagged accounts; flagged ones need a TOTP code less than 91 days old. The app asks for one after 90 days:
-- the extra day keeps an open tab from seeing empty lists before it notices.
create function public.mfa_satisfied() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'mfa_required')::boolean, false) is not true
    or (
      auth.jwt() ->> 'aal' = 'aal2'
      and exists (
        select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]')) as entry
        where entry ->> 'method' = 'totp'
          and (entry ->> 'timestamp')::bigint > extract(epoch from now() - interval '91 days')
      )
    )
$$;

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
  if not public.mfa_satisfied() then
    raise exception 'mfa required' using errcode = '42501';
  end if;
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
  if not public.mfa_satisfied() then
    raise exception 'mfa required' using errcode = '42501';
  end if;
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

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.issues   enable row level security;
alter table public.notes    enable row level security;

-- The creator check lets a new project pass RLS before the trigger has added its membership.
create policy "member projects" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_member(id))
  with check (user_id = (select auth.uid()) or public.is_member(id));

create policy "members of my projects" on public.project_members
  for select to authenticated
  using (public.is_member(project_id));

create policy "member issues" on public.issues
  for all to authenticated
  using (public.is_member(project_id))
  with check (public.is_member(project_id));

create policy "own notes" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.projects, public.project_members, public.issues, public.notes;

-- Images of the notes: private, each user reaches only their own folder (<user id>/<file>).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-images', 'note-images', false, 2097152, array['image/webp', 'image/jpeg']);

create policy "read own note images" on storage.objects
  for select to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "add own note images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "mfa satisfied" on public.projects as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "mfa satisfied" on public.project_members as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "mfa satisfied" on public.issues as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "mfa satisfied" on public.notes as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "mfa satisfied" on storage.objects as restrictive
  for all to authenticated
  using (bucket_id <> 'note-images' or (select public.mfa_satisfied()))
  with check (bucket_id <> 'note-images' or (select public.mfa_satisfied()));
