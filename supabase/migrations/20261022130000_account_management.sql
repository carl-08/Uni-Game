-- Apply after schema.sql and admin_schema.sql.
create table if not exists public.user_bans (
  user_id uuid primary key,
  email text,
  reason text not null,
  banned_by uuid not null,
  banned_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz
);

create table if not exists public.account_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_user_id uuid not null,
  target_email text,
  action text not null check (action in ('ban', 'unban', 'delete')),
  reason text,
  occurred_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'applied', 'partial', 'failed'))
);
create index if not exists account_admin_audit_occurred_idx
  on public.account_admin_audit (occurred_at desc);

alter table public.user_bans enable row level security;
alter table public.account_admin_audit enable row level security;
revoke all on public.user_bans, public.account_admin_audit from public, anon, authenticated;
grant select on public.user_bans, public.account_admin_audit to service_role;

create or replace function public.is_user_banned(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_bans b
    where b.user_id = check_user_id and b.revoked_at is null
  );
$$;
revoke all on function public.is_user_banned(uuid) from public, anon;
grant execute on function public.is_user_banned(uuid) to authenticated;

create or replace function public.reject_banned_user_token(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  token_user_id uuid := (event->>'user_id')::uuid;
  token_email text := lower(coalesce(event->'claims'->>'email', ''));
begin
  if public.is_user_banned(token_user_id) or (
    token_email <> '' and exists (
      select 1 from public.user_bans b
      where b.revoked_at is null and lower(b.email) = token_email
    )
  ) then
    raise exception 'account_banned' using errcode = 'P0001';
  end if;
  return jsonb_build_object('claims', event->'claims');
end;
$$;
revoke all on function public.reject_banned_user_token(jsonb) from public, anon, authenticated;
grant execute on function public.reject_banned_user_token(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

create or replace function public.admin_search_accounts(search_term text, p_actor_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  avatar text,
  created_at timestamptz,
  is_banned boolean,
  is_admin boolean,
  ban_reason text,
  is_deleted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select result.user_id, result.email, result.display_name, result.avatar, result.created_at,
    result.is_banned, result.is_admin, result.ban_reason, result.is_deleted
  from (
    select
      u.id as user_id,
      u.email::text as email,
      coalesce(p.display_name, 'Player') as display_name,
      coalesce(p.avatar, '🎮') as avatar,
      u.created_at as created_at,
      (b.user_id is not null) as is_banned,
      (a.user_id is not null) as is_admin,
      b.reason as ban_reason,
      false as is_deleted
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.user_bans b on b.user_id = u.id and b.revoked_at is null
    left join public.admin_users a on a.user_id = u.id
    where (
      coalesce(trim(search_term), '') = ''
      or position(lower(trim(search_term)) in lower(coalesce(u.email, ''))) > 0
      or position(lower(trim(search_term)) in lower(coalesce(p.display_name, ''))) > 0
      or position(lower(trim(search_term)) in lower(u.id::text)) > 0
    )
      and exists (select 1 from public.admin_users actor where actor.user_id = p_actor_id)
      and not public.is_user_banned(p_actor_id)
    union all
    select
      deleted.target_user_id,
      deleted.target_email,
      'Deleted account'::text,
      '🗑️'::text,
      deleted.occurred_at,
      false,
      false,
      null::text,
      true
    from (
      select distinct on (audit.target_user_id)
        audit.target_user_id, audit.target_email, audit.occurred_at
      from public.account_admin_audit audit
      where audit.action = 'delete' and audit.status in ('applied', 'pending', 'partial')
      order by audit.target_user_id, audit.occurred_at desc
    ) deleted
    where not exists (select 1 from auth.users u where u.id = deleted.target_user_id)
      and (
        coalesce(trim(search_term), '') = ''
        or position(lower(trim(search_term)) in lower(coalesce(deleted.target_email, ''))) > 0
        or position(lower(trim(search_term)) in lower(deleted.target_user_id::text)) > 0
      )
      and exists (select 1 from public.admin_users actor where actor.user_id = p_actor_id)
      and not public.is_user_banned(p_actor_id)
  ) result
  order by result.created_at desc
  limit 250;
$$;
revoke all on function public.admin_search_accounts(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_search_accounts(text, uuid) to service_role;

create or replace function public.admin_begin_account_action(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_target_email text,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare audit_id bigint;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_id)
    or public.is_user_banned(p_actor_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_actor_id = p_target_user_id then
    raise exception 'cannot_manage_self' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.admin_users where user_id = p_target_user_id) then
    raise exception 'cannot_manage_admin' using errcode = 'P0001';
  end if;
  if p_action not in ('ban', 'unban', 'delete') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if p_action = 'ban' then
    insert into public.user_bans (user_id, email, reason, banned_by, banned_at, revoked_by, revoked_at)
    values (p_target_user_id, p_target_email, coalesce(nullif(trim(p_reason), ''), 'No reason provided'), p_actor_id, now(), null, null)
    on conflict (user_id) do update set
      email = excluded.email,
      reason = excluded.reason,
      banned_by = excluded.banned_by,
      banned_at = excluded.banned_at,
      revoked_by = null,
      revoked_at = null;
  elsif p_action = 'unban' then
    update public.user_bans
    set revoked_by = p_actor_id, revoked_at = now()
    where user_id = p_target_user_id and revoked_at is null;
    if not found then
      raise exception 'not_banned' using errcode = 'P0001';
    end if;
  end if;
  insert into public.account_admin_audit (actor_id, target_user_id, target_email, action, reason)
  values (p_actor_id, p_target_user_id, p_target_email, p_action, nullif(trim(p_reason), ''))
  returning id into audit_id;
  return audit_id;
end;
$$;
revoke all on function public.admin_begin_account_action(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_begin_account_action(uuid, uuid, text, text, text) to service_role;

create or replace function public.admin_finish_account_action(p_audit_id bigint, p_status text, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor_id)
    or public.is_user_banned(p_actor_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_status not in ('applied', 'partial', 'failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.account_admin_audit set status = p_status where id = p_audit_id and actor_id = p_actor_id;
  if not found then
    raise exception 'audit_record_not_found' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.admin_finish_account_action(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_finish_account_action(bigint, text, uuid) to service_role;

drop policy if exists "Players read own profile" on public.profiles;
create policy "Players read own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id and not public.is_user_banned((select auth.uid())));
drop policy if exists "Players create own profile" on public.profiles;
create policy "Players create own profile" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id and not public.is_user_banned((select auth.uid())));
drop policy if exists "Players update own profile" on public.profiles;
create policy "Players update own profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id and not public.is_user_banned((select auth.uid())))
  with check ((select auth.uid()) = user_id and not public.is_user_banned((select auth.uid())));
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles" on public.profiles for select to authenticated
  using (
    not public.is_user_banned((select auth.uid()))
    and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
  );

drop policy if exists "Players read own game history" on public.game_history;
create policy "Players read own game history" on public.game_history for select to authenticated
  using ((select auth.uid()) = user_id and not public.is_user_banned((select auth.uid())));
drop policy if exists "Players insert own game history" on public.game_history;
create policy "Players insert own game history" on public.game_history for insert to authenticated
  with check ((select auth.uid()) = user_id and not public.is_user_banned((select auth.uid())));
drop policy if exists "Admins can read all game history" on public.game_history;
create policy "Admins can read all game history" on public.game_history for select to authenticated
  using (
    not public.is_user_banned((select auth.uid()))
    and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
  );

drop policy if exists "Admins can update game availability" on public.game_controls;
create policy "Admins can update game availability" on public.game_controls for update to authenticated
  using (
    not public.is_user_banned((select auth.uid()))
    and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
  )
  with check (
    not public.is_user_banned((select auth.uid()))
    and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
  );
