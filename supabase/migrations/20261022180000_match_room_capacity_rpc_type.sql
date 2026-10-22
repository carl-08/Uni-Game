-- PostgREST receives p_max_players from the browser as an integer, so the RPC
-- argument must use integer rather than smallint for signature resolution.
drop function public.room_create(text, smallint);

create function public.room_create(p_game_key text, p_max_players integer default 8)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.game_rooms;
  attempt int;
  j int;
  code_suffix text;
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if public.is_user_banned(uid) then raise exception 'account_banned'; end if;
  if p_max_players not between 3 and 15 then raise exception 'invalid_capacity'; end if;
  if not exists (select 1 from public.game_controls where game_key = p_game_key and enabled) then
    raise exception 'game_unavailable';
  end if;
  if not exists (select 1 from public.profiles where user_id = uid) then raise exception 'profile_required'; end if;

  for attempt in 1..5 loop
    begin
      code_suffix := '';
      for j in 1..4 loop
        code_suffix := code_suffix || substr(
          alphabet,
          get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet) + 1,
          1
        );
      end loop;
      insert into public.game_rooms(code, host_user_id, game_key, max_players)
      values ('GTH-' || code_suffix, uid, p_game_key, p_max_players)
      returning * into r;
      insert into public.game_room_members(room_id, user_id, ready) values (r.id, uid, true);
      return jsonb_build_object('id', r.id, 'code', r.code);
    exception when unique_violation then
      if attempt = 5 then raise exception 'room_code_collision'; end if;
    end;
  end loop;
end;
$$;

revoke all on function public.room_create(text, integer) from public, anon;
grant execute on function public.room_create(text, integer) to authenticated;
