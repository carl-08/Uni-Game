import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowLeft, Check, Copy, Crown, DoorOpen, LoaderCircle, Play, QrCode, RefreshCw, Send, Shield, Sparkles, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { storyCards } from '../data/storyCards';
import StoryCard from './StoryCard';
import './room-system.css';

type Player = { user_id: string; display_name: string; avatar: string; ready: boolean };
type Choice = { choice_id: string; card_id: string; is_mine?: boolean; owner_id?: string };
type Room = { id: string; code: string; host_user_id: string; game_key: string; status: string; max_players: number; expires_at: string; players: Player[]; game?: { phase: string; round: number; storyteller_id: string; clue: string | null; scores: Record<string, number>; submissions_count: number; votes_count: number; hand: string[]; choices: Choice[]; results: { correct_votes: number; non_storytellers: number; scores: Record<string, number>; choices: Choice[]; story_card: string } | null } };
type GameOption = { game_key: string; enabled: boolean };
type Props = { initialMode: 'create' | 'join'; initialCode?: string; selectedGame?: string; onExit: () => void };

const gameNames: Record<string, string> = { imposter: 'Imposter', family_trivia: 'Family Trivia', picture_clues: 'Picture Clues', push_your_luck: 'Push Your Luck', charades: 'Charades', draw_guess: 'Draw & Guess', word_spy: 'Word Spy', railway_rush: 'Railway Rush', dreamweaver: 'Dreamweaver' };
function friendlyError(error: { message?: string } | null, fallback: string) {
  const message = error?.message?.toLowerCase() ?? '';
  const codes: Array<[string, string]> = [['sign_in_required','Sign in again, then try once more.'],['account_banned','This account cannot join or manage rooms.'],['profile_required','Save a player profile before joining a room.'],['game_unavailable','That game is currently unavailable.'],['room_not_found','We could not find that room code. Check it and try again.'],['room_expired','This room has expired. Ask the host for a new invitation.'],['room_not_open','This room is closed or has already started.'],['room_full','This room is full.'],['not_a_member','Join this room before opening it.'],['need_three_players','You need at least three players to start Dreamweaver.'],['players_not_ready','Wait until every player is ready.'],['not_authorized','Your session cannot perform this room action.'],['invalid_story','Choose a card and enter a clue from 1 to 120 characters.'],['invalid_submission','Choose an available card. You can submit once per round.'],['invalid_vote','Choose a card that is not your own. You can vote once.']];
  return codes.find(([code]) => message.includes(code))?.[1] ?? fallback;
}

export default function RoomExperience({ initialMode, initialCode = '', selectedGame = 'dreamweaver', onExit }: Props) {
  const [mode, setMode] = useState<'create' | 'join'>(initialMode);
  const [codeInput, setCodeInput] = useState(initialCode);
  const [gameKey, setGameKey] = useState(selectedGame);
  const [gameOptions, setGameOptions] = useState<GameOption[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clue, setClue] = useState('');
  const [selectedCard, setSelectedCard] = useState('');
  const [transferTarget, setTransferTarget] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState('Connecting…');
  const [confirmAction, setConfirmAction] = useState<'transfer' | 'close' | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<string>('');
  const me = room?.players.find(player => player.user_id === meRef.current);
  const isHost = Boolean(room && room.host_user_id === meRef.current);
  const inviteUrl = useMemo(() => {
    if (!room) return '';
    const base = import.meta.env.PROD ? 'https://carl-08.github.io/Uni-Game/' : new URL(import.meta.env.BASE_URL, window.location.origin).toString();
    return `${base}?room=${encodeURIComponent(room.code)}`;
  }, [room]);

  const ensureIdentity = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured. Add the project URL and public anon key to .env.local.');
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data, error: authError } = await supabase.auth.signInAnonymously();
      if (authError) throw authError;
      session = data.session;
    }
    if (!session?.user) throw new Error('Could not start a guest session.');
    meRef.current = session.user.id;
    const { error: profileError } = await supabase.from('profiles').upsert({ user_id: session.user.id, display_name: `Player ${session.user.id.slice(0, 4)}`, avatar: '🎮' }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (profileError) throw profileError;
    return session.user.id;
  }, []);

  const loadRoom = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data, error: stateError } = await supabase.rpc('room_state', { p_room_id: id });
    if (stateError) { setError(friendlyError(stateError, 'Could not refresh this room.')); return; }
    const nextRoom = data as unknown as Room;
    const url = new URL(window.location.href); url.searchParams.set('room', nextRoom.code);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    setRoom(nextRoom);
  }, []);

  const refreshGames = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('game_controls').select('game_key,enabled').eq('enabled', true).order('game_key');
    setGameOptions((data ?? []) as GameOption[]);
  }, []);

  const enterRoom = useCallback(async (action: 'create' | 'join', rawCode?: string) => {
    if (!supabase) { setError('Supabase is not configured. Add the project URL and public anon key to .env.local.'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      await ensureIdentity();
      let roomId: string | null = null;
      if (action === 'create') {
        const { data, error: createError } = await supabase.rpc('room_create', { p_game_key: gameKey, p_max_players: 8 });
        if (createError) throw createError;
        roomId = (data as { id: string }).id;
      } else {
        const { data, error: joinError } = await supabase.rpc('room_join', { p_code: (rawCode ?? codeInput).trim().toUpperCase() });
        if (joinError) throw joinError;
        roomId = data as string | null;
        if (!roomId) throw new Error('room_expired');
      }
      if (!roomId) throw new Error('Could not open the room.');
      await loadRoom(roomId);
    } catch (cause) {
      setError(friendlyError(cause as { message?: string }, cause instanceof Error ? cause.message : 'Could not open the room.'));
    } finally { setLoading(false); }
  }, [codeInput, ensureIdentity, gameKey, loadRoom]);

  useEffect(() => { void refreshGames(); }, [refreshGames]);
  useEffect(() => { if (initialCode) { setMode('join'); setCodeInput(initialCode); void enterRoom('join', initialCode); } }, [initialCode, enterRoom]);

  useEffect(() => {
    if (!room || !supabase) return;
    const channel = supabase.channel(`room:${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${room.id}` }, () => void loadRoom(room.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_room_members', filter: `room_id=eq.${room.id}` }, () => void loadRoom(room.id))
      .subscribe(status => setRealtimeStatus(status === 'SUBSCRIBED' ? 'Connected · updates live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'Reconnecting · refreshing every 8 seconds' : 'Connecting…'));
    const timer = window.setInterval(() => void loadRoom(room.id), 8000);
    return () => { window.clearInterval(timer); void supabase?.removeChannel(channel); };
  }, [loadRoom, room?.id]);

  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (!supabase || !room) return;
    setError(''); setNotice('');
    const { error: actionError } = await supabase.rpc(name as never, args as never);
    if (actionError) { setError(friendlyError(actionError, 'That room action did not go through.')); return; }
    await loadRoom(room.id);
  };
  const copyText = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); }
    catch { setError('Clipboard access is unavailable in this browser.'); }
  };
  const downloadQr = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas || !room) return;
    const anchor = document.createElement('a'); anchor.download = `Gather-${room.code}.png`; anchor.href = canvas.toDataURL('image/png'); anchor.click();
  };
  const currentGame = room?.game;
  const leaders = currentGame ? room?.players.filter(player => (currentGame.scores[player.user_id] ?? 0) === Math.max(...Object.values(currentGame.scores))) ?? [] : [];
  const winnerText = leaders.length > 1 ? `A shared dream: ${leaders.map(player => player.display_name).join(' and ')}!` : leaders[0] ? `${leaders[0].display_name} wins the dream!` : 'A lovely story.';
  const cardMap = useMemo(() => new Map(storyCards.map(card => [card.id, card])), []);
  const storyAction = async (action: string, cardId?: string, clueValue?: string, choiceId?: string) => {
    await rpc('story_action', { p_room_id: room?.id, p_action: action, p_card_id: cardId ?? null, p_clue: clueValue ?? null, p_choice_id: choiceId ?? null });
    setSelectedCard(''); setClue('');
  };

  if (room) return <main className="room-shell wrap">
    <header className="room-topbar"><button className="btn btn-quiet" onClick={onExit}><ArrowLeft size={16}/> Gather</button><div className="brand"><span className="brand-mark"><Sparkles size={18}/></span><span>gather<span className="brand-dot">.</span></span></div><span className={`room-status ${room.status}`}>{room.status.replace('_',' ')}</span></header>
    {(room.status === 'closed' || room.status === 'expired') ? <section className="room-closed"><DoorOpen size={42}/><div className="eyebrow">ROOM {room.status.toUpperCase()}</div><h1>This room has ended.</h1><p>Ask the host for a fresh invitation to play again.</p><button className="btn btn-primary" onClick={onExit}>Back to Gather</button></section> : room.game_key === 'dreamweaver' && currentGame ? <section className="dream-game">
      <div className="game-heading"><div><div className="eyebrow">DREAMWEAVER · ROUND {currentGame.round} OF 6</div><h1>{currentGame.phase === 'complete' ? winnerText : 'What does it make you think of?'}</h1><p>{currentGame.phase === 'story' ? (currentGame.storyteller_id === meRef.current ? 'Choose one card and write a clue.' : `${room.players.find(p=>p.user_id===currentGame.storyteller_id)?.display_name ?? 'The storyteller'} is thinking of a clue.`) : currentGame.phase === 'submit' ? 'Choose a card that could fit the clue.' : currentGame.phase === 'vote' ? 'Which card belongs to the storyteller?' : 'The cards are revealed.'}</p></div><div className="round-pill">{room.code}</div></div>
      {currentGame.clue && currentGame.phase !== 'story' && <blockquote className="story-clue">“{currentGame.clue}”</blockquote>}
      {currentGame.phase === 'story' && currentGame.storyteller_id === meRef.current && <div className="story-action-panel"><label className="field-label">YOUR CLUE<input value={clue} onChange={e=>setClue(e.target.value.slice(0,120))} placeholder="A small thing, a big feeling…" maxLength={120}/></label><button className="btn btn-primary" disabled={!selectedCard || !clue.trim()} onClick={()=>void storyAction('story',selectedCard,clue)}>Share clue and card <Send size={15}/></button></div>}
      {currentGame.phase === 'submit' && currentGame.storyteller_id !== meRef.current && <div className="story-action-panel"><button className="btn btn-primary" disabled={!selectedCard} onClick={()=>void storyAction('submit',selectedCard)}>Submit this card <Send size={15}/></button><span>{currentGame.submissions_count}/{Math.max(0,room.players.length-1)} submitted</span></div>}
      {currentGame.phase === 'vote' && currentGame.storyteller_id !== meRef.current && <p className="room-help">Pick a card. You can’t vote for your own submission.</p>}
      {currentGame.phase === 'vote' && currentGame.storyteller_id === meRef.current && <p className="room-help">Players are choosing a card. Votes are hidden until everyone has voted.</p>}
      {(currentGame.phase === 'story' && currentGame.storyteller_id===meRef.current || currentGame.phase === 'submit' && currentGame.storyteller_id!==meRef.current) && <div className="story-card-grid">{currentGame.hand.map(id=>{ const card=cardMap.get(id); return card?<StoryCard key={id} card={card} selected={selectedCard===id} onClick={()=>setSelectedCard(id)}/>:null; })}</div>}
      {currentGame.phase === 'vote' && currentGame.storyteller_id !== meRef.current && <div className="story-card-grid">{currentGame.choices.map(choice=>{const card=cardMap.get(choice.card_id);return card?<StoryCard key={choice.choice_id} card={card} selected={selectedCard===choice.choice_id} disabled={choice.is_mine} onClick={()=>setSelectedCard(choice.choice_id)}/>:null;})}<button className="btn btn-primary" disabled={!selectedCard} onClick={()=>void storyAction('vote',undefined,undefined,selectedCard)}>Lock in my guess</button></div>}
      {currentGame.phase === 'vote' && <p className="room-help">{currentGame.votes_count}/{Math.max(0,room.players.length-1)} votes received</p>}
      {(currentGame.phase === 'reveal' || currentGame.phase === 'complete') && currentGame.results && <><div className="reveal-grid">{currentGame.results.choices.map(choice=>{const card=cardMap.get(choice.card_id);const owner=room.players.find(p=>p.user_id===choice.owner_id);return card?<div className="revealed-choice" key={choice.choice_id}><StoryCard card={card} revealed selected={choice.card_id===currentGame.results?.story_card}/><span>{owner?.display_name ?? 'Player'}{choice.card_id===currentGame.results?.story_card?' · storyteller’s card':''}</span></div>:null;})}</div><div className="scoreboard"><h2>Round {currentGame.round} scores</h2>{room.players.map(p=><div key={p.user_id}><span>{p.avatar} {p.display_name}</span><strong>{currentGame.scores[p.user_id] ?? 0}</strong></div>)}</div>{isHost&&currentGame.phase==='reveal'&&<button className="btn btn-primary" onClick={()=>void storyAction('next')}>{currentGame.round===6?'Show winner':'Next round'} <Play size={15}/></button>}{currentGame.phase==='complete'&&<>{isHost&&<div className="room-control-buttons"><button className="btn btn-primary" onClick={()=>void rpc('story_start',{p_room_id:room.id})}><Play size={15}/> Rematch</button><button className="btn btn-danger" onClick={()=>setConfirmAction('close')}><X size={15}/> Close room</button></div>}<p className="room-help">Final scores are saved in game history. Thanks for playing.</p></>}</>}
    </section> : <section className="room-layout">
      <div className="room-main"><div className="eyebrow">GAME NIGHT LOBBY</div><h1>Bring your people in.</h1><p className="room-help">Share the code or scan the QR. Room codes are invitations, not passwords.</p>
        <div className="room-invite"><div className="room-code-block"><span>ROOM CODE</span><strong>{room.code}</strong><div><button className="btn btn-outline" onClick={()=>void copyText(room.code,'Room code')}><Copy size={15}/> Copy code</button><button className="btn btn-outline" onClick={()=>void copyText(inviteUrl,'Invitation link')}><Copy size={15}/> Copy invite</button></div></div><div className="room-qr" ref={qrRef}><QRCodeCanvas value={inviteUrl} size={188} level="H" includeMargin bgColor="#fffdf4" fgColor="#171912"/><button className="btn btn-outline" onClick={downloadQr}><QrCode size={15}/> Download QR</button></div></div>
        <div className="room-members-heading"><h2>Players</h2><span>{room.players.length} / {room.max_players}</span></div><div className="room-members">{room.players.map(player=><div className="room-player" key={player.user_id}><span className="player-face">{player.avatar}</span><span className="player-name">{player.display_name}{player.user_id===room.host_user_id&&<small><Crown size={12}/> Host</small>}</span><span className={`ready-pill ${player.ready?'ready':''}`}>{player.ready?'Ready':'Getting ready'}</span></div>)}</div>
        <div className="room-controls">{isHost?<><label className="field-label">CHOOSE A GAME<select value={room.game_key} disabled={room.status!=='waiting'} onChange={e=>{setGameKey(e.target.value);void rpc('room_set_game',{p_room_id:room.id,p_game_key:e.target.value});}}>{gameOptions.map(g=><option key={g.game_key} value={g.game_key}>{gameNames[g.game_key]??g.game_key}</option>)}</select></label><label className="field-label">TRANSFER HOST<select value={transferTarget} onChange={e=>setTransferTarget(e.target.value)}><option value="">Choose a current player</option>{room.players.filter(p=>p.user_id!==room.host_user_id).map(p=><option value={p.user_id} key={p.user_id}>{p.display_name}</option>)}</select></label><div className="room-control-buttons">{room.game_key==='dreamweaver'?<button className="btn btn-primary" disabled={room.players.length<3||room.players.some(p=>!p.ready)} onClick={()=>void rpc('story_start',{p_room_id:room.id})}><Play size={15}/> Start Dreamweaver</button>:<span className="room-help">This game’s multiplayer rules are not wired up yet. Choose Dreamweaver to start a match.</span>}<button className="btn btn-outline" disabled={!transferTarget} onClick={()=>setConfirmAction('transfer')}><Crown size={15}/> Transfer host</button><button className="btn btn-danger" onClick={()=>setConfirmAction('close')}><X size={15}/> Close room</button></div><p className="room-help">Start requires three players, all marked ready. Abandoned rooms expire after 12 hours.</p></>:<button className="btn btn-primary" onClick={()=>void rpc('room_set_ready',{p_room_id:room.id,p_ready:!me?.ready})}>{me?.ready?<Check size={15}/>:<Sparkles size={15}/>} {me?.ready?'You’re ready':'I’m ready'}</button>}</div>
      </div><aside className="room-side"><div className="room-side-card"><div className="eyebrow">NOW PLAYING</div><h2>{gameNames[room.game_key]??room.game_key}</h2><p>{room.game_key==='dreamweaver'?'A story game made from mysterious images and good clues.':'The host can switch games while the room is waiting.'}</p><div className={`connection-state${realtimeStatus.startsWith('Connected')?'':' reconnecting'}`}><span/>{realtimeStatus}</div><button className="btn btn-outline" onClick={()=>void loadRoom(room.id)}><RefreshCw size={15}/> Refresh room</button></div></aside>
    </section>}
    {error&&<div className="room-alert error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss"><X size={14}/></button></div>}{notice&&<div className="room-alert success"><Check size={15}/>{notice}</div>}
    {confirmAction&&<div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={()=>setConfirmAction(null)} aria-label="Cancel"><X size={20}/></button><div className="modal-icon"><Shield size={22}/></div><h2>{confirmAction==='close'?'Close this room?':'Transfer host?'}</h2><p>{confirmAction==='close'?<>The room will close and its invitation will stop accepting players. {room.status==='in_progress'&&<>The unfinished match stays with the room and will not count as a completed game. </>}Completed game history is kept.</>:'The selected player becomes host, and you remain a regular room member.'}</p><button className="btn btn-primary full-btn" onClick={()=>{if(confirmAction==='close')void rpc('room_close',{p_room_id:room.id});else void rpc('room_transfer_host',{p_room_id:room.id,p_target_user_id:transferTarget});setConfirmAction(null);}}>Confirm {confirmAction==='close'?'close':'transfer'}</button></div></div>}
    {loading&&<div className="room-loading"><LoaderCircle className="spin" size={18}/></div>}
  </main>;

  return <main className="room-shell room-entry wrap"><header className="room-topbar"><button className="btn btn-quiet" onClick={onExit}><ArrowLeft size={16}/> Gather</button><div className="brand"><span className="brand-mark"><Sparkles size={18}/></span><span>gather<span className="brand-dot">.</span></span></div><span/></header><section className="room-entry-card"><div className="modal-icon"><QrCode size={22}/></div><div className="eyebrow">{mode==='create'?'HOST A GAME NIGHT':'YOUR FRIENDS ARE WAITING'}</div><h1>{mode==='create'?'Make a little room.':'Jump into the fun.'}</h1><p>{mode==='create'?'Choose a game and we’ll make a room code for your crew.':'Enter a room code or open an invitation link.'}</p>{mode==='create'?<label className="field-label">CHOOSE A GAME<select value={gameKey} onChange={e=>setGameKey(e.target.value)}>{gameOptions.map(g=><option key={g.game_key} value={g.game_key}>{gameNames[g.game_key]??g.game_key}</option>)}</select></label>:<label className="field-label">ROOM CODE<input autoFocus value={codeInput} onChange={e=>setCodeInput(e.target.value.toUpperCase().slice(0,8))} placeholder="GTH-7K9P" maxLength={8}/></label>}<button className="btn btn-primary btn-large full-btn" disabled={loading||(mode==='join'&&codeInput.trim().length<6)||!gameOptions.some(g=>g.game_key===gameKey)} onClick={()=>void enterRoom(mode)}>{loading?<LoaderCircle className="spin" size={16}/>:mode==='create'?<Play size={16}/>:<DoorOpen size={16}/>} {mode==='create'?'Create room':'Join room'}</button><button className="text-link room-mode-toggle" onClick={()=>{setMode(mode==='create'?'join':'create');setError('')}}>{mode==='create'?'Have a room code? Join instead':'Create a new room instead'}</button>{error&&<div className="room-alert error" role="alert">{error}</div>}<p className="room-footnote">{mode==='create'?'Rooms close when the host closes them and expire after 12 hours.':'Joining requires a Gather guest session and player profile.'}</p></section></main>;
}
