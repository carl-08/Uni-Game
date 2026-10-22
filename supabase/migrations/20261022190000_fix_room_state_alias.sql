-- Avoid an ambiguous reference between the PL/pgSQL row variable and the
-- game_rooms table alias when returning the room state.
create or replace function public.room_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  result jsonb;
  gs jsonb;
  room_row public.game_rooms;
begin
  if uid is null or public.is_user_banned(uid) then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from public.game_room_members where room_id = p_room_id and user_id = uid
  ) then raise exception 'not_a_member'; end if;

  select * into room_row from public.game_rooms where id = p_room_id for update;
  if room_row.expires_at <= now() and room_row.status in ('waiting', 'in_progress') then
    update public.game_rooms set status = 'expired', updated_at = now() where id = p_room_id;
    room_row.status := 'expired';
  end if;

  select jsonb_build_object(
    'id', room_row.id,
    'code', room_row.code,
    'host_user_id', room_row.host_user_id,
    'game_key', room_row.game_key,
    'status', room_row.status,
    'max_players', room_row.max_players,
    'expires_at', room_row.expires_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', p.display_name,
        'avatar', p.avatar,
        'ready', m.ready,
        'joined_at', m.joined_at
      ) order by m.joined_at)
      from public.game_room_members m
      join public.profiles p on p.user_id = m.user_id
      where m.room_id = room_row.id
    ), '[]'::jsonb)
  ) into result
  from public.game_rooms gr
  where gr.id = p_room_id;

  select state into gs from public.story_game_state where room_id = p_room_id;
  if gs is not null then
    result := result || jsonb_build_object(
      'game', jsonb_build_object(
        'phase', gs->>'phase',
        'round', gs->>'round',
        'storyteller_id', gs->>'storyteller_id',
        'clue', gs->'clue',
        'scores', gs->'scores',
        'submissions_count', jsonb_array_length(coalesce(gs->'submissions', '[]'::jsonb)),
        'votes_count', jsonb_array_length(coalesce(gs->'votes', '[]'::jsonb)),
        'hand', coalesce((gs->'hands')->(uid::text), '[]'::jsonb),
        'choices', case
          when gs->>'phase' = 'vote' then coalesce((
            select jsonb_agg(jsonb_build_object(
              'choice_id', c->>'choice_id',
              'card_id', c->>'card_id',
              'is_mine', c->>'owner_id' = uid::text
            ))
            from jsonb_array_elements(coalesce(gs->'choices', '[]'::jsonb)) c
          ), '[]'::jsonb)
          when gs->>'phase' in ('reveal', 'complete') then coalesce(gs->'choices', '[]'::jsonb)
          else '[]'::jsonb
        end,
        'results', case
          when gs->>'phase' in ('reveal', 'complete') then gs->'results'
          else null
        end
      )
    );
  end if;
  return result;
end;
$$;
