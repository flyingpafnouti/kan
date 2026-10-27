-- Run once in the Supabase SQL editor on an existing database.
begin;

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  body       text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_idx on public.notes (user_id, created_at);

create trigger notes_touch before update on public.notes
for each row execute function public.touch_updated_at();

alter table public.notes enable row level security;

create policy "own notes" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.notes;

commit;
