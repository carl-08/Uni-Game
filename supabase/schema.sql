-- Run this in Supabase Dashboard -> SQL Editor.
-- Never expose the service_role key in frontend code.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 24),
  avatar text not null default '🎮' check (char_length(avatar) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.game_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null check (char_length(game_key) between 1 and 64),
  score integer not null default 0,
  won boolean not null default false,
  played_at timestamptz not null default now()
);
create index if not exists game_history_user_played_idx on public.game_history (user_id, played_at desc);
create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
alter table public.profiles enable row level security;
alter table public.game_history enable row level security;
drop policy if exists "Players read own profile" on public.profiles;
create policy "Players read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Players create own profile" on public.profiles;
create policy "Players create own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Players update own profile" on public.profiles;
create policy "Players update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Players read own game history" on public.game_history;
create policy "Players read own game history" on public.game_history for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Players insert own game history" on public.game_history;
create policy "Players insert own game history" on public.game_history for insert to authenticated with check ((select auth.uid()) = user_id);
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.game_history to authenticated;
