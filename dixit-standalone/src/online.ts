import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_DIXIT_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_DIXIT_SUPABASE_ANON_KEY as string | undefined;
export const dixitSupabase: SupabaseClient | null = url && anonKey && !url.includes('your-project') && !anonKey.includes('your-supabase')
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export async function ensureDixitSession() {
  if (!dixitSupabase) throw new Error('Online play is not configured. You can still use Local demo.');
  const { data: { session } } = await dixitSupabase.auth.getSession();
  if (session?.user) return session.user.id;
  const { data, error } = await dixitSupabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error('Could not start a guest session. Try again.');
  return data.user.id;
}

export type OnlinePlayer = { id: string; name: string; score: number; status: string };
export type OnlineEntry = { choice_id: string; card_id: string; owner_id?: string; is_mine?: boolean };
export type OnlineVote = { user_id: string; choice_id: string };
export type OnlineSummary = { player_id: string; base: number; bonus: number; total: number; correct: boolean; received_votes: number; note: string };
export type OnlineRoomState = {
  room_id: string; code: string; room_status: 'waiting'|'playing'|'ended'; is_host: boolean;
  phase: 'lobby'|'clue'|'submit'|'vote'|'results'|'over'; minimum_players: number; round: number;
  storyteller_id: string|null; last_storyteller: string|null; clue: string|null; players: OnlinePlayer[];
  hand: string[]; entries: OnlineEntry[]; votes: OnlineVote[]; summary: OnlineSummary[];
  submitted_count: number; votes_count: number; eligible_votes: number;
};

export function friendlyOnlineError(error: unknown) {
  const raw = error instanceof Error ? error.message : '';
  const message = raw.toLowerCase();
  const known: Array<[string,string]> = [
    ['room_not_found','We could not find that room code. Check it and try again.'],
    ['display_name_required','Enter a display name before joining.'],
    ['room_already_started','This room has already started. Ask the host for a new room.'],
    ['room_not_waiting','This room is no longer waiting for players.'],
    ['room_not_playing','This game room is no longer active.'],
    ['room_full','This room already has eight players.'],
    ['not_enough_players','Wait for the minimum number of players before starting.'],
    ['host_has_no_player_seat','The host runs the shared display and does not join as a player.'],
    ['not_a_room_member','This browser is not connected to that room. Join with the room code first.'],
    ['invalid_clue','Choose one of your cards and enter a clue with no spaces.'],
    ['invalid_submission','Choose one card from your hand. You can submit once per round.'],
    ['invalid_vote','That vote is not allowed. You can vote once and cannot choose your own card.'],
    ['host_only','Only the host can do that from the shared display.'],
    ['round_not_ready','Wait until this round is revealed.'],
    ['sign_in_required','Could not connect as a guest. Refresh and try again.'],
    ['failed to fetch','The room server could not be reached. Check your connection and try again.'],
    ['invalid api key','Online room settings are not valid. Ask the host to check this standalone app’s Supabase setup.'],
  ];
  return known.find(([part]) => message.includes(part))?.[1] ?? (raw || 'That room action did not go through. Try again.');
}
