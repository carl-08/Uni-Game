import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Crown, DoorOpen, Eye, LoaderCircle, Play, RefreshCw, Sparkles, Users, X } from 'lucide-react';
import { dixitSupabase, ensureDixitSession, friendlyOnlineError, type OnlineRoomState } from './online';
import { makeDeck } from './game';

const cards = new Map(makeDeck().map(card => [card.id, card]));
type Props = { initialCode?: string; initialRole?: string; onBack: () => void };

export default function OnlineRoom({ initialCode = '', initialRole = '', onBack }: Props) {
  const [room, setRoom] = useState<OnlineRoomState | null>(null);
  const [roomId, setRoomId] = useState('');
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [reconnectCode, setReconnectCode] = useState('');
  const [selectedCard, setSelectedCard] = useState('');
  const [selectedChoice, setSelectedChoice] = useState('');
  const [clue, setClue] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadRoom = useCallback(async (id: string) => {
    if (!dixitSupabase) return;
    const { data, error: callError } = await dixitSupabase.rpc('dixit_get_room', { p_room_id: id });
    if (callError) throw callError;
    setRoom(data as unknown as OnlineRoomState);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const timer = window.setInterval(() => { void loadRoom(roomId).catch(reason => setError(friendlyOnlineError(reason))); }, 1800);
    return () => window.clearInterval(timer);
  }, [loadRoom, roomId]);

  const openByCode = useCallback(async (rawCode: string, role?: string) => {
    if (!dixitSupabase) throw new Error('Online play is not configured. You can still use Local demo.');
    const uid = await ensureDixitSession(); setUserId(uid);
    const { data: id, error: findError } = await dixitSupabase.rpc('dixit_find_room', { p_code: rawCode.trim().toUpperCase() });
    if (findError) throw findError;
    const roomUuid = id as string; setRoomId(roomUuid);
    await loadRoom(roomUuid);
    const params = new URLSearchParams(window.location.search); params.set('online','1'); params.set('room',rawCode.trim().toUpperCase());
    if (role) params.set('role',role); else params.delete('role');
    window.history.replaceState({},'',`${window.location.pathname}?${params.toString()}`);
  }, [loadRoom]);

  useEffect(() => {
    if (!initialCode || !initialRole) return;
    void openByCode(initialCode, initialRole).catch(reason => setError(friendlyOnlineError(reason)));
  }, [initialCode, initialRole, openByCode]);

  const createRoom = async () => {
    if (!dixitSupabase) { setError('Online play is not configured. You can still use Local demo.'); return; }
    setBusy(true); setError('');
    try {
      const uid = await ensureDixitSession(); setUserId(uid);
      const { data, error: createError } = await dixitSupabase.rpc('dixit_create_room');
      if (createError) throw createError;
      const created = data as { room_id: string; code: string };
      setRoomId(created.room_id); await loadRoom(created.room_id);
      const params = new URLSearchParams(); params.set('online','1'); params.set('room',created.code); params.set('role','host');
      window.history.replaceState({},'',`${window.location.pathname}?${params.toString()}`);
      sessionStorage.setItem('dixit-host-room', created.code);
    } catch (reason) { setError(friendlyOnlineError(reason)); }
    finally { setBusy(false); }
  };

  const joinRoom = async () => {
    if (!dixitSupabase) { setError('Online play is not configured. You can still use Local demo.'); return; }
    setBusy(true); setError('');
    try {
      const uid = await ensureDixitSession(); setUserId(uid);
      const { data, error: joinError } = await dixitSupabase.rpc('dixit_join_room', { p_code: code.trim().toUpperCase(), p_display_name: name.trim() });
      if (joinError) throw joinError;
      const joined = data as { room_id: string; code: string };
      setRoomId(joined.room_id); await loadRoom(joined.room_id);
      const params = new URLSearchParams(); params.set('online','1'); params.set('room',joined.code); params.set('role','player');
      window.history.replaceState({},'',`${window.location.pathname}?${params.toString()}`);
    } catch (reason) { setError(friendlyOnlineError(reason)); }
    finally { setBusy(false); }
  };

  const act = async (rpcName: string, args: Record<string, unknown> = {}): Promise<boolean> => {
    if (!dixitSupabase || !roomId) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: actionError } = await dixitSupabase.rpc(rpcName as never, { p_room_id: roomId, ...args } as never);
      if (actionError) throw actionError;
      await loadRoom(roomId); setSelectedCard(''); setSelectedChoice(''); setClue('');
      return true;
    } catch (reason) { setError(friendlyOnlineError(reason)); return false; }
    finally { setBusy(false); }
  };

  const startGame = async () => {
    const started = await act('dixit_start_room');
    if (started && room?.players.length === 2) setNotice('Two-player test mode: with one voter, the storyteller cannot score under the current scoring rules.');
  };

  const startNextRound = async () => {
    const advanced = await act('dixit_next_round');
    if (!advanced) setError(current => current ? `Could not start the next round. ${current} Your results are still saved; you can retry.` : 'Could not start the next round. Your results are still saved; refresh the room and retry.');
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(room?.code ?? ''); setCopied(true); setTimeout(() => setCopied(false),1600); }
    catch { setError('Clipboard is unavailable. Share the room code shown on screen.'); }
  };

  const storyteller = room?.players.find(player => player.id === room.storyteller_id);
  const isStoryteller = Boolean(room && userId && room.storyteller_id === userId);
  const me = room?.players.find(player => player.id === userId);
  const leaders = room?.players.filter(player => player.score === Math.max(...room.players.map(candidate => candidate.score))) ?? [];
  const cardFor = (id: string) => cards.get(id);
  const isTwoPlayerTest = room?.players.length === 2;

  return <main className="app-shell online-shell">
    <header className="topbar"><button className="online-back" onClick={onBack}><ArrowLeft size={16}/> Local demo</button><span className="brand"><span className="brand-mark"><Sparkles size={18}/></span><span>little <b>fables</b></span></span><span className="demo-badge"><span/>{room?.is_host ? 'SHARED DISPLAY' : room ? 'PLAYER VIEW' : 'ONLINE ROOMS'}</span></header>
    {!room ? <section className="online-lobby"><div className="online-intro"><p className="eyebrow">PRIVATE PLAYER SCREENS · SHARED LAPTOP</p><h1>Bring your people<br/>into the story.</h1><p>Host on a laptop. Players join from their phones with a room code.</p>{!dixitSupabase && <p className="setup-note">Online rooms need a separate Supabase project. Local demo still works now.</p>}</div>
      <div className="online-forms"><section className="waiting-card"><h2>Host a new room</h2><p>You run the shared display. The host does not take a player seat.</p><button className="primary" disabled={busy || !dixitSupabase} onClick={() => void createRoom()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Users size={16}/>} Create host display</button></section>
        <section className="waiting-card"><h2>Join from a phone</h2><label className="field-label" htmlFor="online-name">DISPLAY NAME</label><input id="online-name" className="name-input" maxLength={20} value={name} onChange={event=>setName(event.target.value)} placeholder="Your name"/><label className="field-label" htmlFor="online-code">ROOM CODE</label><input id="online-code" className="name-input" maxLength={8} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="DIX-ABCD"/><button className="primary" disabled={busy || !dixitSupabase || !name.trim() || code.trim().length<4} onClick={() => void joinRoom()}>{busy ? <LoaderCircle className="spin" size={16}/> : <ArrowRight size={16}/>} Join room</button></section>
        <section className="waiting-card reconnect-card"><h2>Reconnect host display</h2><p>Use the same browser session and room code from the host laptop.</p><input className="name-input" aria-label="Room code to reconnect" maxLength={8} value={reconnectCode} onChange={event=>setReconnectCode(event.target.value.toUpperCase())} placeholder="DIX-ABCD"/><button className="secondary-button" disabled={busy || !dixitSupabase || reconnectCode.trim().length<4} onClick={()=>void openByCode(reconnectCode,'host').catch(reason=>setError(friendlyOnlineError(reason)))}>Reconnect to display</button></section>
      </div>
    </section> : <>
      <section className="game-head online-game-head"><div><div className="eyebrow"><span className="eyebrow-line"/> ROOM {room.code} · {room.phase==='lobby'?'WAITING':`ROUND ${String(room.round).padStart(2,'0')}`}</div><h1 className="game-title">{room.phase==='over' ? (leaders.length ? `${leaders.map(player=>player.name).join(' & ')} ${leaders.length>1?'share':'wins'} the story.` : 'Story complete.') : room.phase==='lobby' ? 'Your story room.' : 'A new story unfolds.'}</h1><p className="turn-line">{room.phase==='lobby' ? 'Waiting for players to join from their phones.' : storyteller ? `${storyteller.name} is the storyteller${room.last_storyteller ? ` · ${room.last_storyteller} told the last story` : ''}` : 'Shared game table'}</p></div><div className="round-chip"><Users size={15}/><span>{room.players.length} PLAYERS</span></div></section>
      {room.room_status==='ended' ? <section className="waiting-card ended-room"><DoorOpen size={28}/><h2>This room has ended.</h2><button className="primary" onClick={onBack}>Return to the lobby</button></section> : room.phase==='lobby' ? <section className="online-room-layout">
        <div className="waiting-card room-waiting"><div className="room-code-large"><span>ROOM CODE · SHARE WITH PLAYERS</span><strong>{room.code}</strong><button className="primary" onClick={()=>void copyCode()}><Check size={15}/>{copied?'Copied':'Copy room code'}</button></div><h2>Players joining from phones</h2><div className="joined-list">{room.players.length===0?<p className="empty-players">No players yet. Share the room code to invite your group.</p>:room.players.map((player,index)=><div className="joined-player" key={player.id}><span className="avatar" style={{'--avatar':['#e6a98d','#b9a9e4','#b8d58a','#80c3b4','#e8d35e','#cf7c9a','#9db9ed','#d3a7d8'][index]} as React.CSSProperties}>{player.name.slice(0,1).toUpperCase()}</span><b>{player.name}</b><span>Joined</span></div>)}</div>
          {room.is_host ? <><button className="primary start-online" disabled={busy||room.players.length<room.minimum_players||room.players.length>8} onClick={()=>void startGame()}>{busy?<LoaderCircle className="spin" size={16}/>:<Play size={16}/>} Start game</button><p className="room-help">Start when {room.minimum_players}–8 players have joined. The player list locks when the game starts.</p>{isTwoPlayerTest&&<p className="test-notice"><Sparkles size={15}/> Two-player test mode: with one voter, the storyteller cannot score under the current scoring rules.</p>}<button className="end-room-button" onClick={()=>void act('dixit_end_room')}>End room</button></> : <p className="room-help">Waiting for the host to start. You are in the player list.</p>}
        </div>
        <aside className="sidebar"><div className="table-card"><div className="table-card-head"><span><Users size={15}/> PLAYER LIST</span><span>{room.players.length}/8</span></div>{room.players.map((player,index)=><div className="player-row" key={player.id}><span className="avatar" style={{'--avatar':['#e6a98d','#b9a9e4','#b8d58a','#80c3b4','#e8d35e','#cf7c9a','#9db9ed','#d3a7d8'][index]} as React.CSSProperties}>{player.name.slice(0,1).toUpperCase()}</span><span className="player-name">{player.name}<small>READY</small></span><b>0</b></div>)}<div className="score-note">Host is display-only and has no seat.</div></div></aside>
      </section> : <section className="online-room-layout">
        <div className="phase-panel online-phase-panel">
          {room.phase==='clue' && <><div className="phase-heading"><span className="phase-number">01</span><div><h2>{isStoryteller?'Choose a card and one-word clue':'The storyteller is choosing a clue'}</h2><p>{isStoryteller?'Only you see your hand. Enter one word with no spaces.':'Your hand stays private on this player screen.'}</p></div></div>{isStoryteller ? <><div className="hand-row">{room.hand.map(id=>{const card=cardFor(id);return card?<CardArt key={id} card={card} selected={selectedCard===id} onClick={()=>setSelectedCard(id)}/>:null})}</div><div className="clue-controls"><label className="sr-only" htmlFor="online-clue">Your one-word clue</label><input id="online-clue" className="clue-input" value={clue} maxLength={36} placeholder="One word…" onChange={event=>{if(!/\s/.test(event.target.value))setClue(event.target.value)}}/><button className="primary" disabled={busy||!selectedCard||!clue.trim()||/\s/.test(clue.trim())} onClick={()=>void act('dixit_action',{p_action:'clue',p_card_id:selectedCard,p_clue:clue.trim()})}>Share clue <ArrowRight size={16}/></button></div></>:<p className="spectator-wait">Waiting for {storyteller?.name ?? 'the storyteller'}…</p>}</>}
          {room.phase==='submit' && <><div className="phase-heading"><span className="phase-number">02</span><div><h2>Choose a card for the clue</h2><p>One card from your hand. Other players cannot see your choice yet.</p></div></div><div className="clue-banner"><span>ONE-WORD CLUE</span><strong>{room.clue}</strong></div>{!room.is_host&&!isStoryteller ? (me?.status==='card ready'?<p className="spectator-wait">Your card is submitted. Waiting for the other players.</p>:<><div className="hand-row">{room.hand.map(id=>{const card=cardFor(id);return card?<CardArt key={id} card={card} selected={selectedCard===id} onClick={()=>setSelectedCard(id)}/>:null})}</div><div className="action-row"><span>{room.submitted_count}/{room.players.length-1} cards ready</span><button className="primary" disabled={busy||!selectedCard} onClick={()=>void act('dixit_action',{p_action:'submit',p_card_id:selectedCard})}>Submit card <ArrowRight size={16}/></button></div></>):<p className="spectator-wait">{room.is_host?'Private card selection is in progress.':`Waiting for ${room.players.length-1} cards to arrive.`} {room.submitted_count}/{room.players.length-1} ready.</p>}</>}
          {room.phase==='vote' && <><div className="phase-heading"><span className="phase-number">03</span><div><h2>Who chose the story card?</h2><p>Cards are shuffled and anonymous. Your own card is disabled.</p></div></div><div className="clue-banner"><span>THE CLUE</span><strong>{room.clue}</strong></div><div className="display-grid">{room.entries.map((entry,index)=>{const card=cardFor(entry.card_id);return card?<div className="display-card-wrap" key={entry.choice_id}><span className="card-number">{String(index+1).padStart(2,'0')}</span><CardArt card={card} selected={selectedChoice===entry.choice_id} disabled={room.is_host||isStoryteller||entry.is_mine||me?.status==='vote locked'} onClick={()=>setSelectedChoice(entry.choice_id)} label={`Anonymous card ${index+1}${entry.is_mine?', your card, cannot vote':''}`}/></div>:null})}</div>{!room.is_host&&!isStoryteller ? me?.status==='vote locked' ? <p className="vote-wait"><Eye size={16}/> Your vote is locked and hidden until everyone has voted.</p> : <div className="action-row"><span>{selectedChoice?'1 card selected':'Tap one card to vote'}</span><button className="primary" disabled={busy||!selectedChoice} onClick={()=>void act('dixit_action',{p_action:'vote',p_choice_id:selectedChoice})}>Lock in my guess <ArrowRight size={16}/></button></div> : <p className="vote-wait"><Eye size={16}/> Votes stay secret · {room.votes_count}/{room.eligible_votes} locked</p>}</>}
          {(room.phase==='results'||room.phase==='over') && <><div className="phase-heading"><span className="phase-number">04</span><div><h2>{room.phase==='over'?'The story is complete':'The table reveals its story'}</h2><p>Card owners, votes, and scores are now public.</p></div></div><div className="clue-banner"><span>THE CLUE</span><strong>{room.clue}</strong></div><div className="result-cards">{room.entries.map((entry,index)=>{const card=cardFor(entry.card_id);const owner=room.players.find(player=>player.id===entry.owner_id);const voteCount=room.votes.filter(vote=>vote.choice_id===entry.choice_id).length;const voters=room.votes.map(vote=>vote.choice_id===entry.choice_id?room.players.find(player=>player.id===vote.user_id)?.name:null).filter(Boolean);return card?<div className="result-card" key={entry.choice_id}><span className="card-number">{String(index+1).padStart(2,'0')}</span><CardArt card={card} small disabled/><span>{owner?.name}{entry.card_id===room.entries.find(item=>item.owner_id===room.storyteller_id)?.card_id?' · storyteller’s card':''}</span><small>{voteCount} vote{voteCount===1?'':'s'}{voters.length?` · ${voters.join(', ')}`:''}</small></div>:null})}</div><div className="summary"><div className="summary-head"><span>ROUND SCORE BREAKDOWN</span><span>POINTS</span></div>{room.summary.map(item=><div className="summary-row" key={item.player_id}><span className="summary-name">{item.player_id===room.storyteller_id&&<Crown size={14}/>} {room.players.find(player=>player.id===item.player_id)?.name}</span><span className="summary-detail"><span>{item.note}</span><small>{item.base} base + {item.bonus} bonus · {item.received_votes} vote{item.received_votes===1?'':'s'} on their card</small></span><b>+{item.total}</b></div>)}</div>{room.phase==='results'&&room.is_host&&<button className="primary next-button" disabled={busy} onClick={()=>void startNextRound()}><ArrowRight size={16}/> Next storyteller</button>}{room.phase==='over'&&<p className="gameover-note">{leaders.map(player=>player.name).join(' & ')} {leaders.length>1?'share the win':'wins'}!</p>}</>}
          {room.is_host&&<button className="end-room-button in-game-end" disabled={busy} onClick={()=>void act('dixit_end_room')}><DoorOpen size={15}/> End room</button>}
        </div>
        <aside className="sidebar"><div className="table-card"><div className="table-card-head"><span><Users size={15}/> AT THE TABLE</span><span>{room.players.length} PLAYERS</span></div>{room.players.map((player,index)=><div className={`player-row ${player.id===room.storyteller_id?'story-player':''}`} key={player.id}><span className="avatar" style={{'--avatar':['#e6a98d','#b9a9e4','#b8d58a','#80c3b4','#e8d35e','#cf7c9a','#9db9ed','#d3a7d8'][index]} as React.CSSProperties}>{player.name.slice(0,1).toUpperCase()}</span><span className="player-name">{player.name}{player.id===userId?' (you)':''}<small>{player.status.toUpperCase()}</small></span>{player.id===room.storyteller_id&&<Crown size={15} className="crown"/>}<b>{player.score}</b></div>)}<div className="score-note">First to 30 points wins · Host has no player seat</div></div><button className="secondary-button refresh-online" disabled={busy} onClick={()=>void loadRoom(room.room_id).catch(reason=>setError(friendlyOnlineError(reason)))}><RefreshCw size={14}/> Refresh room</button></aside>
      </section>}
    </>}
    {(notice || (room && room.phase!=='lobby' && isTwoPlayerTest ? 'Two-player test mode: with one voter, the storyteller cannot score under the current scoring rules.' : ''))&&<p className="test-notice"><Sparkles size={15}/>{notice || 'Two-player test mode: with one voter, the storyteller cannot score under the current scoring rules.'}</p>}{error&&<p className="online-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss error"><X size={15}/></button></p>}{busy&&<div className="room-loading"><LoaderCircle className="spin" size={18}/></div>}
  </main>;
}

function CardArt({ card, small=false, selected=false, disabled=false, onClick, label }: {card: NonNullable<ReturnType<typeof cards.get>>; small?:boolean; selected?:boolean; disabled?:boolean; onClick?:()=>void; label?:string}) {
  return <button type="button" className={`art-card has-art ${small?'small':''} ${selected?'selected':''} ${disabled?'unselectable':''}`} disabled={disabled} onClick={onClick} aria-label={label??'Illustrated card'} aria-pressed={selected} style={{'--c1':card.colors[0],'--c2':card.colors[1]} as React.CSSProperties}><img className="art-card-image" src={card.art} alt="" loading="lazy" decoding="async"/></button>;
}
