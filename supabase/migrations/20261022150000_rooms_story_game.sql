-- Room system and original story game. Apply after schema.sql, admin_schema.sql,
-- and the account-management migration. All writes go through checked RPCs.
create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid not null references auth.users(id),
  game_key text not null references public.game_controls(game_key),
  status text not null default 'waiting' check (status in ('waiting','in_progress','completed','closed','expired')),
  max_players smallint not null default 8 check (max_players between 3 and 15),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours',
  closed_at timestamptz
);
create table if not exists public.game_room_members (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id,user_id)
);
create table if not exists public.story_game_state (
  room_id uuid primary key references public.game_rooms(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.game_rooms enable row level security;
alter table public.game_room_members enable row level security;
alter table public.story_game_state enable row level security;
revoke all on public.game_rooms, public.game_room_members, public.story_game_state from anon, authenticated;
grant select on public.game_rooms, public.game_room_members to authenticated;
create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.game_room_members where room_id=p_room_id and user_id=auth.uid())
$$;
revoke all on function public.is_room_member(uuid) from public,anon;
grant execute on function public.is_room_member(uuid) to authenticated;
drop policy if exists "Room members read their room" on public.game_rooms;
create policy "Room members read their room" on public.game_rooms for select to authenticated
 using (public.is_room_member(id));
drop policy if exists "Room members read membership" on public.game_room_members;
create policy "Room members read membership" on public.game_room_members for select to authenticated
 using (public.is_room_member(room_id));
alter publication supabase_realtime add table public.game_rooms;
alter publication supabase_realtime add table public.game_room_members;

insert into public.game_controls(game_key,enabled) values ('dreamweaver',true) on conflict (game_key) do nothing;

create or replace function public.room_create(p_game_key text, p_max_players smallint default 8)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.game_rooms; attempt int; j int; code_suffix text; alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
 if uid is null then raise exception 'sign_in_required'; end if;
 if public.is_user_banned(uid) then raise exception 'account_banned'; end if;
 if p_max_players not between 3 and 15 then raise exception 'invalid_capacity'; end if;
 if not exists(select 1 from public.game_controls where game_key=p_game_key and enabled) then raise exception 'game_unavailable'; end if;
 if not exists(select 1 from public.profiles where user_id=uid) then raise exception 'profile_required'; end if;
 for attempt in 1..5 loop
   begin
     code_suffix:='';
     for j in 1..4 loop code_suffix:=code_suffix||substr(alphabet,get_byte(gen_random_bytes(1),0)%length(alphabet)+1,1); end loop;
     insert into public.game_rooms(code,host_user_id,game_key,max_players)
     values ('GTH-' || code_suffix,uid,p_game_key,p_max_players) returning * into r;
     insert into public.game_room_members(room_id,user_id,ready) values(r.id,uid,true);
     return jsonb_build_object('id',r.id,'code',r.code);
   exception when unique_violation then
     if attempt=5 then raise exception 'room_code_collision'; end if;
   end;
 end loop;
end $$;

create or replace function public.room_join(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.game_rooms; member_count int;
begin
 if uid is null then raise exception 'sign_in_required'; end if;
 if public.is_user_banned(uid) then raise exception 'account_banned'; end if;
 if not exists(select 1 from public.profiles where user_id=uid) then raise exception 'profile_required'; end if;
 select * into r from public.game_rooms where code=upper(regexp_replace(trim(p_code),'\s','','g')) for update;
 if not found then raise exception 'room_not_found'; end if;
 if exists(select 1 from public.game_room_members where room_id=r.id and user_id=uid) then return r.id; end if;
 if r.expires_at <= now() and r.status in ('waiting','in_progress') then
   update public.game_rooms set status='expired',updated_at=now() where id=r.id;
   return null;
 end if;
 if r.status <> 'waiting' then raise exception 'room_not_open'; end if;
 select count(*) into member_count from public.game_room_members where room_id=r.id;
 if member_count >= r.max_players then raise exception 'room_full'; end if;
 insert into public.game_room_members(room_id,user_id) values(r.id,uid) on conflict do nothing;
 return r.id;
end $$;

create or replace function public.room_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result jsonb; gs jsonb; r public.game_rooms;
begin
 if uid is null or public.is_user_banned(uid) then raise exception 'not_authorized'; end if;
 if not exists(select 1 from public.game_room_members where room_id=p_room_id and user_id=uid) then raise exception 'not_a_member'; end if;
 select * into r from public.game_rooms where id=p_room_id for update;
 if r.expires_at<=now() and r.status in ('waiting','in_progress') then update public.game_rooms set status='expired',updated_at=now() where id=p_room_id; r.status:='expired'; end if;
 select jsonb_build_object('id',r.id,'code',r.code,'host_user_id',r.host_user_id,'game_key',r.game_key,'status',r.status,'max_players',r.max_players,'expires_at',r.expires_at,
   'players',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',p.display_name,'avatar',p.avatar,'ready',m.ready,'joined_at',m.joined_at) order by m.joined_at)
      from public.game_room_members m join public.profiles p on p.user_id=m.user_id where m.room_id=r.id),'[]'::jsonb))
 into result from public.game_rooms r where r.id=p_room_id;
 select state into gs from public.story_game_state where room_id=p_room_id;
 if gs is not null then
   result := result || jsonb_build_object('game',jsonb_build_object(
     'phase',gs->>'phase','round',gs->>'round','storyteller_id',gs->>'storyteller_id','clue',gs->'clue',
     'scores',gs->'scores','submissions_count',jsonb_array_length(coalesce(gs->'submissions','[]'::jsonb)),
     'votes_count',jsonb_array_length(coalesce(gs->'votes','[]'::jsonb)),
      'hand',coalesce((gs->'hands')->(uid::text),'[]'::jsonb),
     'choices',case when gs->>'phase'='vote' then coalesce((select jsonb_agg(jsonb_build_object('choice_id',c->>'choice_id','card_id',c->>'card_id','is_mine',c->>'owner_id'=uid::text)) from jsonb_array_elements(coalesce(gs->'choices','[]'::jsonb)) c),'[]'::jsonb) when gs->>'phase' in ('reveal','complete') then coalesce(gs->'choices','[]'::jsonb) else '[]'::jsonb end,
     'results',case when gs->>'phase' in ('reveal','complete') then gs->'results' else null end));
 end if;
 return result;
end $$;

create or replace function public.room_set_ready(p_room_id uuid,p_ready boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or public.is_user_banned(auth.uid()) then raise exception 'not_authorized'; end if;
 update public.game_room_members set ready=p_ready where room_id=p_room_id and user_id=auth.uid();
 if not found then raise exception 'not_a_member'; end if;
end $$;

create or replace function public.room_set_game(p_room_id uuid,p_game_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or public.is_user_banned(auth.uid()) then raise exception 'not_authorized'; end if;
 update public.game_rooms set game_key=p_game_key,updated_at=now() where id=p_room_id and host_user_id=auth.uid() and status='waiting'
 and exists(select 1 from public.game_controls where game_key=p_game_key and enabled);
 if not found then raise exception 'host_or_game_unavailable'; end if;
end $$;

create or replace function public.room_transfer_host(p_room_id uuid,p_target_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or public.is_user_banned(auth.uid()) then raise exception 'not_authorized'; end if;
 update public.game_rooms set host_user_id=p_target_user_id,updated_at=now() where id=p_room_id and host_user_id=auth.uid() and status in ('waiting','in_progress')
 and expires_at>now() and not public.is_user_banned(p_target_user_id)
 and exists(select 1 from public.game_room_members where room_id=p_room_id and user_id=p_target_user_id);
 if not found then raise exception 'host_or_member_required'; end if;
end $$;

create or replace function public.room_close(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or public.is_user_banned(auth.uid()) then raise exception 'not_authorized'; end if;
 update public.game_rooms set status='closed',closed_at=now(),updated_at=now() where id=p_room_id and host_user_id=auth.uid() and status in ('waiting','in_progress','completed');
 if not found then raise exception 'host_or_open_room_required'; end if;
end $$;

create or replace function public.story_start(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); r public.game_rooms; players uuid[]; cards text[]; hands jsonb:='{}'::jsonb; scores jsonb:='{}'::jsonb; i int; j int:=1; n int;
begin
 if uid is null or public.is_user_banned(uid) then raise exception 'not_authorized'; end if;
 select * into r from public.game_rooms where id=p_room_id for update;
 if r.host_user_id<>uid or r.status not in ('waiting','completed') or r.game_key<>'dreamweaver' then raise exception 'host_room_game_required'; end if;
 if r.expires_at<=now() then update public.game_rooms set status='expired',updated_at=now() where id=p_room_id; return; end if;
 if not exists(select 1 from public.game_controls where game_key='dreamweaver' and enabled) then raise exception 'game_unavailable'; end if;
 select array_agg(user_id order by joined_at) into players from public.game_room_members where room_id=p_room_id;
 n:=coalesce(array_length(players,1),0);
 if n<3 then raise exception 'need_three_players'; end if;
 if n>8 then raise exception 'too_many_players_for_game'; end if;
 if exists(select 1 from public.game_room_members where room_id=p_room_id and not ready) then raise exception 'players_not_ready'; end if;
 select array_agg(card_id order by random()) into cards from (values
 ('moon-bridge'),('sky-whale'),('season-door'),('landscape-hourglass'),('glowing-island'),('cloud-library'),('star-lighthouse'),('cosmic-paper-boat'),('impossible-library'),('sunset-city'),('astronaut-star'),('lantern-treehouse'),('sleeping-mountain'),('glass-garden'),('midnight-train'),('floating-orchard'),('blue-comet'),('pocket-ocean'),('wind-harp'),('stairway-rain'),('quiet-volcano'),('cloud-ballet'),('mirror-forest'),('last-firefly'),('garden-planet'),('paper-moon'),('winter-cabin'),('river-sky'),('clockwork-bird'),('hidden-cove'),('amber-desert'),('dreaming-fox'),('rainbow-cavern'),('night-market'),('sunken-observatory'),('seed-of-stars'),('silver-waterfall'),('map-of-winds'),('lantern-fleet'),('cloud-shepherd'),('comet-kitchen'),('sleeping-giant'),('velvet-storm'),('secret-greenhouse'),('tiny-kingdom'),('starlit-well'),('blue-door'),('dawn-ship')) deck(card_id);
 for i in 1..n loop
   hands:=hands||jsonb_build_object(players[i]::text,jsonb_build_array(cards[j],cards[j+1],cards[j+2],cards[j+3],cards[j+4],cards[j+5]));
   scores:=scores||jsonb_build_object(players[i]::text,0); j:=j+6;
 end loop;
 insert into public.story_game_state(room_id,state) values(p_room_id,jsonb_build_object('phase','story','round',1,'storyteller_id',players[1],'hands',hands,'scores',scores,'submissions','[]'::jsonb,'votes','[]'::jsonb,'choices','[]'::jsonb,'results',null))
 on conflict(room_id) do update set state=excluded.state,updated_at=now();
 update public.game_rooms set status='in_progress',updated_at=now() where id=p_room_id;
end $$;

create or replace function public.story_action(p_room_id uuid,p_action text,p_card_id text default null,p_clue text default null,p_choice_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); r public.game_rooms; s jsonb; hands jsonb; subs jsonb; choices jsonb; votes jsonb; players uuid[]; tally int; i int; j int; round_no int; deck text[]; new_hands jsonb; scores jsonb; all_count int; owner_id uuid; voter_id uuid; vote_count int; result jsonb; next_storyteller uuid; remaining jsonb; card_id text; played_id text; player_id uuid;
begin
 if uid is null or public.is_user_banned(uid) then raise exception 'not_authorized'; end if;
 select * into r from public.game_rooms where id=p_room_id for update;
 if r.expires_at<=now() then update public.game_rooms set status='expired',updated_at=now() where id=p_room_id; return; end if;
 if r.status<>'in_progress' or not exists(select 1 from public.game_room_members where room_id=p_room_id and user_id=uid) then raise exception 'room_or_member_required'; end if;
 select state into s from public.story_game_state where room_id=p_room_id for update;
 if s is null then raise exception 'game_not_started'; end if;
 hands:=s->'hands'; subs:=s->'submissions'; choices:=s->'choices'; votes:=s->'votes'; round_no:=(s->>'round')::int;
 if p_action='story' then
   if s->>'phase'<>'story' or s->>'storyteller_id'<>uid::text or p_card_id is null or not (hands->uid::text ? p_card_id) or length(trim(coalesce(p_clue,''))) not between 1 and 120 then raise exception 'invalid_story'; end if;
   s:=jsonb_set(s,'{phase}','"submit"'::jsonb)||jsonb_build_object('clue',to_jsonb(trim(p_clue)),'story_card',p_card_id,'submissions','[]'::jsonb);
 elsif p_action='submit' then
   if s->>'phase'<>'submit' or s->>'storyteller_id'=uid::text or p_card_id is null or not (hands->uid::text ? p_card_id) or exists(select 1 from jsonb_array_elements(subs) x where x->>'user_id'=uid::text) then raise exception 'invalid_submission'; end if;
   subs:=subs||jsonb_build_array(jsonb_build_object('user_id',uid,'card_id',p_card_id)); s:=jsonb_set(s,'{submissions}',subs);
   select array_agg(user_id) into players from public.game_room_members where room_id=p_room_id and user_id<>(s->>'storyteller_id')::uuid;
   if jsonb_array_length(subs)=coalesce(array_length(players,1),0) then
     choices:=jsonb_build_array(jsonb_build_object('choice_id',gen_random_uuid(),'card_id',s->>'story_card','owner_id',s->>'storyteller_id'));
     for i in 0..jsonb_array_length(subs)-1 loop choices:=choices||jsonb_build_array(jsonb_build_object('choice_id',gen_random_uuid(),'card_id',subs->i->>'card_id','owner_id',subs->i->>'user_id')); end loop;
     select jsonb_agg(value order by random()) into choices from jsonb_array_elements(choices);
     s:=jsonb_set(s,'{choices}',choices); s:=jsonb_set(s,'{phase}','"vote"'::jsonb); s:=jsonb_set(s,'{votes}','[]'::jsonb);
   end if;
 elsif p_action='vote' then
   if s->>'phase'<>'vote' or s->>'storyteller_id'=uid::text or exists(select 1 from jsonb_array_elements(votes) x where x->>'user_id'=uid::text) or not exists(select 1 from jsonb_array_elements(choices) x where x->>'choice_id'=p_choice_id and x->>'owner_id'<>uid::text) then raise exception 'invalid_vote'; end if;
   votes:=votes||jsonb_build_array(jsonb_build_object('user_id',uid,'choice_id',p_choice_id)); s:=jsonb_set(s,'{votes}',votes);
   select count(*) into all_count from public.game_room_members where room_id=p_room_id and user_id<>(s->>'storyteller_id')::uuid;
   if jsonb_array_length(votes)=all_count then
     select count(*) into tally from jsonb_array_elements(votes) v join jsonb_array_elements(choices) c on c->>'choice_id'=v->>'choice_id' where c->>'card_id'=s->>'story_card';
     scores:=s->'scores';
     if tally>0 and tally<all_count then scores:=jsonb_set(scores,array[s->>'storyteller_id'],to_jsonb((scores->>(s->>'storyteller_id'))::int+3)); end if;
     if tally=0 or tally=all_count then
       for player_id in select user_id from public.game_room_members where room_id=p_room_id and user_id<>(s->>'storyteller_id')::uuid loop
         scores:=jsonb_set(scores,array[player_id::text],to_jsonb((scores->>player_id::text)::int+2));
       end loop;
     end if;
     for i in 0..jsonb_array_length(votes)-1 loop
       if tally>0 and tally<all_count and (select c->>'card_id'=s->>'story_card' from jsonb_array_elements(choices) c where c->>'choice_id'=votes->i->>'choice_id') then
         voter_id:=(votes->i->>'user_id')::uuid;
         scores:=jsonb_set(scores,array[voter_id::text],to_jsonb((scores->>voter_id::text)::int+3));
       end if;
     end loop;
     for i in 0..jsonb_array_length(choices)-1 loop
       select (c->>'owner_id')::uuid into owner_id from jsonb_array_elements(choices) c where c->>'choice_id'=choices->i->>'choice_id';
       select count(*) into vote_count from jsonb_array_elements(votes) v where v->>'choice_id'=choices->i->>'choice_id';
       if owner_id<>(s->>'storyteller_id')::uuid and vote_count>0 then scores:=jsonb_set(scores,array[owner_id::text],to_jsonb((scores->>owner_id::text)::int+vote_count)); end if;
     end loop;
     result:=jsonb_build_object('correct_votes',tally,'non_storytellers',all_count,'scores',scores,'choices',choices,'votes',votes,'story_card',s->>'story_card');
     s:=jsonb_set(s,'{scores}',scores); s:=jsonb_set(s,'{results}',result); s:=jsonb_set(s,'{phase}','"reveal"'::jsonb);
   end if;
 elsif p_action='next' then
   if s->>'phase'<>'reveal' or r.host_user_id<>uid then raise exception 'host_reveal_required'; end if;
   round_no:=round_no+1;
   if round_no>6 then s:=jsonb_set(s,'{phase}','"complete"'::jsonb); update public.game_rooms set status='completed',updated_at=now() where id=p_room_id;
   insert into public.game_history(user_id,game_key,score,won)
   select m.user_id,'dreamweaver',(s->'scores'->>m.user_id::text)::int,(s->'scores'->>m.user_id::text)::int=(select max((value#>>'{}')::int) from jsonb_each(s->'scores'))
   from public.game_room_members m where m.room_id=p_room_id;
   else
     select array_agg(user_id order by joined_at) into players from public.game_room_members where room_id=p_room_id;
     next_storyteller:=players[((round_no-1-1)%array_length(players,1))+1];
     select array_agg(card_id order by random()) into deck from unnest(array['moon-bridge','sky-whale','season-door','landscape-hourglass','glowing-island','cloud-library','star-lighthouse','cosmic-paper-boat','impossible-library','sunset-city','astronaut-star','lantern-treehouse','sleeping-mountain','glass-garden','midnight-train','floating-orchard','blue-comet','pocket-ocean','wind-harp','stairway-rain','quiet-volcano','cloud-ballet','mirror-forest','last-firefly','garden-planet','paper-moon','winter-cabin','river-sky','clockwork-bird','hidden-cove','amber-desert','dreaming-fox','rainbow-cavern','night-market','sunken-observatory','seed-of-stars','silver-waterfall','map-of-winds','lantern-fleet','cloud-shepherd','comet-kitchen','sleeping-giant','velvet-storm','secret-greenhouse','tiny-kingdom','starlit-well','blue-door','dawn-ship']) card_id;
     new_hands:='{}'::jsonb;
     foreach player_id in array players loop
       played_id:=case when player_id=(s->>'storyteller_id')::uuid then s->>'story_card' else (select sub->>'card_id' from jsonb_array_elements(subs) sub where sub->>'user_id'=player_id::text) end;
       select coalesce(jsonb_agg(item.value),'[]'::jsonb) into remaining from jsonb_array_elements_text(coalesce(hands->player_id::text,'[]'::jsonb)) as item(value) where item.value<>played_id;
       new_hands:=new_hands||jsonb_build_object(player_id::text,remaining);
     end loop;
     select coalesce(array_agg(cards_to_draw.card_id order by random()),'{}') into deck from unnest(array['moon-bridge','sky-whale','season-door','landscape-hourglass','glowing-island','cloud-library','star-lighthouse','cosmic-paper-boat','impossible-library','sunset-city','astronaut-star','lantern-treehouse','sleeping-mountain','glass-garden','midnight-train','floating-orchard','blue-comet','pocket-ocean','wind-harp','stairway-rain','quiet-volcano','cloud-ballet','mirror-forest','last-firefly','garden-planet','paper-moon','winter-cabin','river-sky','clockwork-bird','hidden-cove','amber-desert','dreaming-fox','rainbow-cavern','night-market','sunken-observatory','seed-of-stars','silver-waterfall','map-of-winds','lantern-fleet','cloud-shepherd','comet-kitchen','sleeping-giant','velvet-storm','secret-greenhouse','tiny-kingdom','starlit-well','blue-door','dawn-ship']) as cards_to_draw(card_id) where not exists(select 1 from jsonb_each(new_hands) h cross join lateral jsonb_array_elements_text(h.value) as held(value) where held.value=cards_to_draw.card_id);
     for i in 1..array_length(players,1) loop
       player_id:=players[i];
       new_hands:=jsonb_set(new_hands,array[player_id::text],(new_hands->player_id::text)||jsonb_build_array(deck[i]));
     end loop;
     s:=s||jsonb_build_object('phase','story','round',round_no,'storyteller_id',next_storyteller,'hands',new_hands,'clue',null,'story_card',null,'submissions','[]'::jsonb,'votes','[]'::jsonb,'choices','[]'::jsonb,'results',null);
   end if;
 else raise exception 'unsupported_action'; end if;
 update public.story_game_state set state=s,updated_at=now() where room_id=p_room_id;
 update public.game_rooms set updated_at=now() where id=p_room_id;
end $$;

revoke all on function public.room_create(text,smallint),public.room_join(text),public.room_state(uuid),public.room_set_ready(uuid,boolean),public.room_set_game(uuid,text),public.room_transfer_host(uuid,uuid),public.room_close(uuid),public.story_start(uuid),public.story_action(uuid,text,text,text,text) from public,anon;
grant execute on function public.room_create(text,smallint),public.room_join(text),public.room_state(uuid),public.room_set_ready(uuid,boolean),public.room_set_game(uuid,text),public.room_transfer_host(uuid,uuid),public.room_close(uuid),public.story_start(uuid),public.story_action(uuid,text,text,text,text) to authenticated;
