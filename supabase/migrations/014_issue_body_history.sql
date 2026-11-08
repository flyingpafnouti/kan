-- Run once in the Supabase SQL editor on an existing database.
-- Former bodies of the issues an agent account (is_agent) rewrote or appended to, the last 20 per issue, so a bad
-- rewrite through the MCP server can be undone. Filled by a trigger only: nobody writes the table directly.
-- Restore one:
--   select id, saved_at, left(body, 80) from issue_body_history where issue_id = '...' order by id desc;
--   update issues set body = (select body from issue_body_history where id = ...) where id = '...';
begin;

create table public.issue_body_history (
  id       bigint generated always as identity primary key,
  issue_id uuid not null references public.issues on delete cascade,
  body     text not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users on delete set null
);

create index issue_body_history_issue_idx on public.issue_body_history (issue_id, id);

-- Security definer: the table has no insert policy.
create function public.keep_issue_body() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_agent() and new.body is distinct from old.body then
    insert into issue_body_history (issue_id, body, saved_by) values (old.id, old.body, auth.uid());
    delete from issue_body_history
    where issue_id = old.id
      and id not in (select id from issue_body_history where issue_id = old.id order by id desc limit 20);
  end if;
  return new;
end $$;

create trigger issues_keep_body before update of body on public.issues
for each row execute function public.keep_issue_body();

alter table public.issue_body_history enable row level security;

create policy "member issue history" on public.issue_body_history
  for select to authenticated
  using (exists (select 1 from public.issues i where i.id = issue_id and public.is_member(i.project_id)));

create policy "mfa satisfied" on public.issue_body_history as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

commit;
