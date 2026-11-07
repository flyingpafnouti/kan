-- Run once in the Supabase SQL editor on an existing database, before deploying the app that shows pseudos.
-- A pseudo per account, shown as the author of the last change instead of "me" or "others".
begin;

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  pseudo  text not null check (char_length(pseudo) between 1 and 40)
);

-- Security definer so the policy can look at memberships without recursing into RLS.
create function public.shares_project(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members a join project_members b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

-- New accounts start with the part of their email before the @.
create function public.add_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, pseudo) values (new.id, left(coalesce(split_part(new.email, '@', 1), 'user'), 40))
  on conflict do nothing;
  return new;
end $$;

create trigger users_add_profile after insert on auth.users
for each row execute function public.add_profile();

alter table public.profiles enable row level security;

create policy "profiles of my teammates" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.shares_project(user_id));

create policy "own profile" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "mfa satisfied" on public.profiles as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- Existing accounts.
insert into public.profiles (user_id, pseudo)
select id, left(coalesce(split_part(email, '@', 1), 'user'), 40) from auth.users
on conflict do nothing;

update public.profiles set pseudo = 'Gwen' where user_id = (select id from auth.users where email = 'flyingpafnouti@gmail.com');
update public.profiles set pseudo = 'Nav'  where user_id = (select id from auth.users where email = 'nav@nav.com');

alter publication supabase_realtime add table public.profiles;

commit;
