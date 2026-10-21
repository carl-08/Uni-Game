-- Gather admin dashboard and game availability.
-- Run AFTER supabase/schema.sql in Supabase SQL Editor.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.game_controls (
  game_key text primary key check (char_length(game_key) between 1 and 64),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.game_controls (game_key, enabled) values
 ('imposter',true),('family_trivia',true),('picture_clues',true),('push_your_luck',true),
 ('charades',true),('draw_guess',true),('word_spy',true),('railway_rush',true)
on conflict (game_key) do nothing;

alter table public.admin_users enable row level security;
alter table public.game_controls enable row level security;
drop policy if exists "Admins can read own admin membership" on public.admin_users;
create policy "Admins can read own admin membership" on public.admin_users
 for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Authenticated users can view game availability" on public.game_controls;
create policy "Authenticated users can view game availability" on public.game_controls
 for select to anon, authenticated using (true);
drop policy if exists "Admins can update game availability" on public.game_controls;
create policy "Admins can update game availability" on public.game_controls
 for update to authenticated using (
  exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
 ) with check (
  exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
 );
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles" on public.profiles for select to authenticated
 using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Admins can read all game history" on public.game_history;
create policy "Admins can read all game history" on public.game_history for select to authenticated
 using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
grant select on public.admin_users to authenticated;
grant select on public.game_controls to anon, authenticated;
grant update on public.game_controls to authenticated;
