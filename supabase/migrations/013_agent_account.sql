-- Run once in the Supabase SQL editor on an existing database.
-- Accounts flagged with app_metadata.agent (the MCP server's account) work on the issues of the projects they joined,
-- but cannot delete an issue, create, change or delete a project, or touch notes and note images. Enforced here, so
-- holding the account's password gives no more than that. app_metadata is writable only with the service key.
-- Create the account in Authentication > Add user ("Auto confirm"), then flag it and name it:
--   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"agent": true}' where email = '...';
--   update public.profiles set pseudo = 'Claude' where user_id = (select id from auth.users where email = '...');
begin;

create function public.is_agent() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'agent')::boolean, false)
$$;

-- Bumping the project's updated_at would otherwise fall under the agent's ban on project updates.
create or replace function public.touch_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update projects set updated_at = now() where id = coalesce(new.project_id, old.project_id);
  return null;
end $$;

create policy "not agent" on public.issues as restrictive
  for delete to authenticated
  using (not (select public.is_agent()));

create policy "not agent insert" on public.projects as restrictive
  for insert to authenticated
  with check (not (select public.is_agent()));

create policy "not agent update" on public.projects as restrictive
  for update to authenticated
  using (not (select public.is_agent()));

create policy "not agent delete" on public.projects as restrictive
  for delete to authenticated
  using (not (select public.is_agent()));

create policy "not agent" on public.notes as restrictive
  for all to authenticated
  using (not (select public.is_agent())) with check (not (select public.is_agent()));

create policy "not agent" on storage.objects as restrictive
  for insert to authenticated
  with check (bucket_id <> 'note-images' or not (select public.is_agent()));

commit;
