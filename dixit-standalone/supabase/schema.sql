-- Run this in a dedicated Supabase project's SQL editor.
-- All game state is read and changed through authenticated RPC functions.
create table if not exists public.dixit_settings (
  singleton boolean primary key default true check (singleton),
  minimum_players integer not null default 2 check (minimum_players between 2 and 3)
);
insert into public.dixit_settings(singleton, minimum_players) values (true, 2) on conflict (singleton) do nothing;

create table if not exists public.dixit_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','playing','ended')),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.dixit_members (
  room_id uuid not null references public.dixit_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 20),
  seat_order integer not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat_order)
);
alter table public.dixit_rooms enable row level security;
alter table public.dixit_members enable row level security;
alter table public.dixit_settings enable row level security;
revoke all on public.dixit_rooms, public.dixit_members, public.dixit_settings from anon, authenticated;

create or replace function public.dixit_create_room()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.dixit_rooms; candidate text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  loop
    candidate := 'DIX-';
    for i in 1..4 loop candidate := candidate || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1); end loop;
    begin insert into public.dixit_rooms(code, host_id) values(candidate, uid) returning * into r; exit;
    exception when unique_violation then null; end;
  end loop;
  return jsonb_build_object('room_id', r.id, 'code', r.code, 'role', 'host');
end $$;

create or replace function public.dixit_join_room(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.dixit_rooms; n int; clean_name text := left(trim(coalesce(p_display_name,'')),20);
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if clean_name = '' then raise exception 'display_name_required'; end if;
  select * into r from public.dixit_rooms where code=upper(trim(p_code)) for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  if r.status <> 'waiting' then raise exception 'room_already_started'; end if;
  if r.host_id = uid then raise exception 'host_has_no_player_seat'; end if;
  select count(*) into n from public.dixit_members where room_id=r.id;
  if n >= 8 then raise exception 'room_full'; end if;
  insert into public.dixit_members(room_id,user_id,display_name,seat_order)
    values(r.id,uid,clean_name,n+1)
    on conflict(room_id,user_id) do update set display_name=excluded.display_name;
  return jsonb_build_object('room_id',r.id,'code',r.code,'role','player');
end $$;

create or replace function public.dixit_find_room(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.dixit_rooms;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  select * into r from public.dixit_rooms where code=upper(trim(p_code));
  if r.id is null then raise exception 'room_not_found'; end if;
  if r.host_id <> uid and not exists(select 1 from public.dixit_members where room_id=r.id and user_id=uid) then raise exception 'not_a_room_member'; end if;
  return r.id;
end $$;

create or replace function public.dixit_get_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.dixit_rooms; s jsonb; is_host boolean; is_member boolean; phase text; my_hand jsonb := '[]'::jsonb; safe_entries jsonb := '[]'::jsonb; visible_votes jsonb := '[]'::jsonb; people jsonb; result jsonb;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  select * into r from public.dixit_rooms where id=p_room_id;
  if r.id is null then raise exception 'room_not_found'; end if;
  is_host := r.host_id=uid;
  is_member := exists(select 1 from public.dixit_members where room_id=r.id and user_id=uid);
  if not is_host and not is_member then raise exception 'not_a_room_member'; end if;
  s := r.state; phase := coalesce(s->>'phase','lobby');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.user_id,'name',m.display_name,'score',coalesce((s->'scores'->>m.user_id::text)::int,0),
    'status',case when m.user_id=(s->>'storyteller_id')::uuid then 'storyteller'
      when phase='submit' and exists(select 1 from jsonb_array_elements(coalesce(s->'submissions','[]'::jsonb)) x where x->>'user_id'=m.user_id::text) then 'card ready'
      when phase='vote' and exists(select 1 from jsonb_array_elements(coalesce(s->'votes','[]'::jsonb)) x where x->>'user_id'=m.user_id::text) then 'vote locked'
      when phase in ('results','over') then 'round score' else 'playing' end
  ) order by m.seat_order),'[]'::jsonb) into people from public.dixit_members m where m.room_id=r.id;
  if is_member then my_hand := coalesce(s->'hands'->uid::text,'[]'::jsonb); end if;
  if phase='vote' then
    select coalesce(jsonb_agg(jsonb_build_object('choice_id',x->>'choice_id','card_id',x->>'card_id','is_mine',(x->>'owner_id')=uid::text) order by ord),'[]'::jsonb)
      into safe_entries from jsonb_array_elements(coalesce(s->'entries','[]'::jsonb)) with ordinality as e(x,ord);
  elsif phase in ('results','over') then safe_entries := coalesce(s->'entries','[]'::jsonb); visible_votes := coalesce(s->'votes','[]'::jsonb); end if;
  result := jsonb_build_object('room_id',r.id,'code',r.code,'room_status',r.status,'is_host',is_host,'phase',phase,
    'minimum_players',(select minimum_players from public.dixit_settings where singleton), 'round',coalesce((s->>'round')::int,0),
    'storyteller_id',s->>'storyteller_id','last_storyteller',s->>'last_storyteller','clue',s->>'clue',
    'players',people,'hand',my_hand,'entries',safe_entries,'votes',visible_votes,'summary',coalesce(s->'summary','[]'::jsonb),
    'submitted_count',jsonb_array_length(coalesce(s->'submissions','[]'::jsonb)),
    'votes_count',jsonb_array_length(coalesce(s->'votes','[]'::jsonb)),
    'eligible_votes',greatest(jsonb_array_length(people)-1,0));
  return result;
end $$;

create or replace function public.dixit_start_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.dixit_rooms; players uuid[]; cards text[]; hands jsonb := '{}'::jsonb; scores jsonb := '{}'::jsonb; i int; pos int := 1; n int; min_players int;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  select * into r from public.dixit_rooms where id=p_room_id for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  if r.host_id<>uid then raise exception 'host_only'; end if;
  if r.status<>'waiting' then raise exception 'room_not_waiting'; end if;
  select minimum_players into min_players from public.dixit_settings where singleton;
  select array_agg(user_id order by seat_order) into players from public.dixit_members where room_id=p_room_id;
  n:=coalesce(array_length(players,1),0);
  if n<min_players then raise exception 'not_enough_players'; end if;
  if n>8 then raise exception 'room_full'; end if;
  select array_agg('card-'||lpad(card_no::text,3,'0') order by random()) into cards from generate_series(1,84) as card_series(card_no);
  for i in 1..n loop
    hands:=hands||jsonb_build_object(players[i]::text,jsonb_build_array(cards[pos],cards[pos+1],cards[pos+2],cards[pos+3],cards[pos+4],cards[pos+5]));
    scores:=scores||jsonb_build_object(players[i]::text,0); pos:=pos+6;
  end loop;
  update public.dixit_rooms set status='playing',updated_at=now(),state=jsonb_build_object(
    'phase','clue','round',1,'storyteller_id',players[1],'hands',hands,'deck',to_jsonb(cards[pos:]),'discard','[]'::jsonb,
    'scores',scores,'submissions','[]'::jsonb,'entries','[]'::jsonb,'votes','[]'::jsonb,'summary','[]'::jsonb)
    where id=p_room_id;
end $$;

create or replace function public.dixit_action(p_room_id uuid,p_action text,p_card_id text default null,p_clue text default null,p_choice_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid:=auth.uid(); r public.dixit_rooms; s jsonb; hands jsonb; submissions jsonb; entries jsonb; votes jsonb; scores jsonb;
  players uuid[]; storyteller_id uuid; story_entry text; choice jsonb; summary jsonb:='[]'::jsonb;
  i int; n int; correct_count int; eligible int; everyone_or_no_one boolean; player_id uuid; base_points int; bonus_points int; is_correct boolean; current_score int;
  deck text[]; discard text[]; used text[]; hand text[]; card text; next_phase text;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  select * into r from public.dixit_rooms where id=p_room_id for update;
  if r.id is null or r.status<>'playing' then raise exception 'room_not_playing'; end if;
  if not exists(select 1 from public.dixit_members where room_id=p_room_id and user_id=uid) then raise exception 'player_only'; end if;
  s:=r.state; hands:=s->'hands'; submissions:=coalesce(s->'submissions','[]'::jsonb); entries:=coalesce(s->'entries','[]'::jsonb); votes:=coalesce(s->'votes','[]'::jsonb); scores:=s->'scores';
  storyteller_id:=(s->>'storyteller_id')::uuid;
  select array_agg(user_id order by seat_order) into players from public.dixit_members where room_id=p_room_id;
  n:=array_length(players,1);
  if p_action='clue' then
    if s->>'phase'<>'clue' or uid<>storyteller_id or not (hands->uid::text ? p_card_id) or trim(coalesce(p_clue,''))='' or p_clue ~ '\s' then raise exception 'invalid_clue'; end if;
    s:=s||jsonb_build_object('phase','submit','clue',trim(p_clue),'story_card_id',p_card_id,
      'submissions','[]'::jsonb,'entries','[]'::jsonb,'votes','[]'::jsonb);
  elsif p_action='submit' then
    if s->>'phase'<>'submit' or uid=storyteller_id or not (hands->uid::text ? p_card_id) or exists(select 1 from jsonb_array_elements(submissions) x where x->>'user_id'=uid::text) then raise exception 'invalid_submission'; end if;
    submissions:=submissions||jsonb_build_array(jsonb_build_object('user_id',uid,'card_id',p_card_id)); s:=jsonb_set(s,'{submissions}',submissions);
    if jsonb_array_length(submissions)=n-1 then
      select jsonb_agg(value order by random()) into entries from (
        select jsonb_build_object('choice_id',gen_random_uuid(),'card_id',s->>'story_card_id','owner_id',storyteller_id) value
        union all
        select jsonb_build_object('choice_id',gen_random_uuid(),'card_id',x->>'card_id','owner_id',x->>'user_id') value from jsonb_array_elements(submissions) x
      ) shuffled;
      s:=s||jsonb_build_object('phase','vote','entries',entries,'votes','[]'::jsonb);
    end if;
  elsif p_action='vote' then
    if s->>'phase'<>'vote' or uid=storyteller_id or exists(select 1 from jsonb_array_elements(votes) x where x->>'user_id'=uid::text) then raise exception 'invalid_vote'; end if;
    select value into choice from jsonb_array_elements(entries) where value->>'choice_id'=p_choice_id;
    if choice is null or choice->>'owner_id'=uid::text then raise exception 'invalid_vote'; end if;
    votes:=votes||jsonb_build_array(jsonb_build_object('user_id',uid,'choice_id',p_choice_id)); s:=jsonb_set(s,'{votes}',votes);
    eligible:=n-1;
    if jsonb_array_length(votes)=eligible then
      select x->>'choice_id' into story_entry from jsonb_array_elements(entries) x where x->>'card_id'=s->>'story_card_id';
      select count(*) into correct_count from jsonb_array_elements(votes) v where v->>'choice_id'=story_entry;
      everyone_or_no_one:=correct_count=0 or correct_count=eligible;
      scores:=s->'scores';
      foreach player_id in array players loop
        base_points:=0; bonus_points:=0; is_correct:=false;
        if player_id=storyteller_id then base_points:=case when everyone_or_no_one then 0 else 3 end;
        else
          select exists(select 1 from jsonb_array_elements(votes) v where v->>'user_id'=player_id::text and v->>'choice_id'=story_entry) into is_correct;
          if everyone_or_no_one then base_points:=2; elsif is_correct then base_points:=3; end if;
          select count(*) into bonus_points from jsonb_array_elements(entries) e join jsonb_array_elements(votes) v on v->>'choice_id'=e->>'choice_id' where e->>'owner_id'=player_id::text;
        end if;
        current_score:=coalesce((scores->>player_id::text)::int,0)+base_points+bonus_points;
        scores:=jsonb_set(scores,array[player_id::text],to_jsonb(current_score));
        summary:=summary||jsonb_build_array(jsonb_build_object('player_id',player_id,'base',base_points,'bonus',bonus_points,'total',base_points+bonus_points,
          'correct',is_correct,'received_votes',bonus_points,'note',case when player_id=storyteller_id and everyone_or_no_one then 'Storyteller scores 0 because everyone or nobody guessed correctly.' when player_id<>storyteller_id and everyone_or_no_one then 'Every non-storyteller scores 2 because everyone or nobody guessed correctly.' when player_id=storyteller_id then 'Some, but not all, players found the story card.' when is_correct then 'You found the storyteller’s card.' else 'Your vote missed the storyteller’s card.' end));
      end loop;
      select coalesce(array_agg(e->>'card_id'),'{}') into used from jsonb_array_elements(entries) e;
      select coalesce(array_agg(value),'{}') into discard from jsonb_array_elements_text(coalesce(s->'discard','[]'::jsonb)) d(value);
      discard:=discard||used;
      select coalesce(array_agg(value),'{}') into deck from jsonb_array_elements_text(coalesce(s->'deck','[]'::jsonb)) d(value);
      for i in 1..n loop
        player_id:=players[i];
        select coalesce(array_agg(value),'{}') into hand from jsonb_array_elements_text(hands->player_id::text) h(value) where not (value=any(used));
        if cardinality(deck)=0 and cardinality(discard)>0 then select array_agg(value order by random()) into deck from unnest(discard) d(value); discard:='{}'; end if;
        if cardinality(deck)>0 and cardinality(hand)<6 then card:=deck[cardinality(deck)]; deck:=deck[1:cardinality(deck)-1]; hand:=hand||card; end if;
        hands:=jsonb_set(hands,array[player_id::text],to_jsonb(hand));
      end loop;
      if exists(select 1 from jsonb_each_text(scores) x where x.value::int>=30) then next_phase:='over'; else next_phase:='results'; end if;
      s:=s||jsonb_build_object('phase',next_phase,'scores',scores,'summary',summary,'hands',hands,'deck',to_jsonb(deck),'discard',to_jsonb(discard));
    end if;
  else raise exception 'unsupported_action'; end if;
  update public.dixit_rooms set state=s,updated_at=now() where id=p_room_id;
end $$;

create or replace function public.dixit_next_round(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); r public.dixit_rooms; s jsonb; players uuid[]; n int; next_index int; previous_id uuid; next_id uuid;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  select * into r from public.dixit_rooms where id=p_room_id for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  if r.status<>'playing' then raise exception 'room_not_playing'; end if;
  if r.host_id<>uid then raise exception 'host_only'; end if;
  s:=r.state;
  if s->>'phase'<>'results' then raise exception 'round_not_ready'; end if;
  select array_agg(user_id order by seat_order) into players from public.dixit_members where room_id=p_room_id;
  n:=array_length(players,1); previous_id:=(s->>'storyteller_id')::uuid;
  select coalesce(array_position(players,previous_id),0) into next_index;
  next_index:=case when next_index>=n then 1 else next_index+1 end; next_id:=players[next_index];
  s:=s||jsonb_build_object('phase','clue','round',(s->>'round')::int+1,'last_storyteller',previous_id,'storyteller_id',next_id,
    'clue',null,'story_card_id',null,'submissions','[]'::jsonb,'entries','[]'::jsonb,'votes','[]'::jsonb,'summary','[]'::jsonb);
  update public.dixit_rooms set state=s,updated_at=now() where id=p_room_id;
end $$;

create or replace function public.dixit_end_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.dixit_rooms where id=p_room_id and host_id=auth.uid()) then raise exception 'host_only'; end if;
  update public.dixit_rooms set status='ended',updated_at=now() where id=p_room_id;
end $$;

revoke all on function public.dixit_create_room(),public.dixit_join_room(text,text),public.dixit_find_room(text),public.dixit_get_room(uuid),public.dixit_start_room(uuid),public.dixit_action(uuid,text,text,text,text),public.dixit_next_round(uuid),public.dixit_end_room(uuid) from public, anon;
grant execute on function public.dixit_create_room(),public.dixit_join_room(text,text),public.dixit_find_room(text),public.dixit_get_room(uuid),public.dixit_start_room(uuid),public.dixit_action(uuid,text,text,text,text),public.dixit_next_round(uuid),public.dixit_end_room(uuid) to authenticated;
