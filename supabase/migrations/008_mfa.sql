-- Run once in the Supabase SQL editor on an existing database.
-- Authenticator app (TOTP) for the accounts flagged with app_metadata.mfa_required. Inert until an account is flagged.
-- Flag an account only once the app handling this requirement is deployed, or its data looks empty:
--   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"mfa_required": true}' where email = '...';
begin;

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

-- Security definer functions bypass the policies above.
create or replace function public.join_project(token uuid) returns uuid
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

create or replace function public.leave_project(pid uuid) returns void
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

commit;
