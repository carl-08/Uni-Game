import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Crown, Eye, Feather, Heart, RefreshCw, Sparkles, Users, Volume2 } from 'lucide-react';
import { castVote, giveClue, makeDeck, newGame, nextRound, submitCards, storyteller, type Card, type Game } from './game';
import OnlineRoom from './OnlineRoom';

function CardArt({ card, small = false, selected = false, disabled = false, onClick, label }: {
  card: Card; small?: boolean; selected?: boolean; disabled?: boolean; onClick?: () => void; label?: string;
}) {
  return <button type="button" aria-label={label ?? `Card: ${card.title}${selected ? ', selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick}
    className={`art-card ${card.art ? 'has-art' : ''} ${small ? 'small' : ''} ${selected ? 'selected' : ''} ${disabled ? 'unselectable' : ''}`}
    style={{ '--c1': card.colors[0], '--c2': card.colors[1] } as React.CSSProperties}>
    <span className="art-sky"/><span className={`art-shape ${card.shape}`}><i>{card.motif}</i></span><span className="art-spark">✧</span>
    {card.art ? <img className="art-card-image" src={card.art} alt="" loading="lazy" decoding="async"/> : null}{selected && <span className="picked"><Check size={14}/></span>}
  </button>;
}

const artPreviewCards = makeDeck();
const demoNames = ['You', 'Mira', 'Theo', 'Nico', 'Luna', 'Jules', 'Mika', 'Ivo'];

export default function App() {
  const displayOnly = new URLSearchParams(window.location.search).get('view') === 'display';
  const [game, setGame] = useState<Game | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [clue, setClue] = useState('');
  const [name, setName] = useState('Carl');
  const [playerCount, setPlayerCount] = useState(3);
  const [demoNotice, setDemoNotice] = useState('');
  const [error, setError] = useState('');
  const [showLobby, setShowLobby] = useState(true);
  const [help, setHelp] = useState(false);
  const [gallery, setGallery] = useState(false);

  const me = game?.players[0];
  const currentStoryteller = game ? storyteller(game) : null;
  const isStoryteller = currentStoryteller?.id === me?.id;
  const myHand = me?.hand ?? [];

  const start = () => {
    const names = [name.trim() || 'You', ...demoNames.slice(1, playerCount)];
    setGame(newGame(names));
    setShowLobby(false);
    setSelected([]);
    setError('');
    setDemoNotice(playerCount === 2 ? 'Two-player test mode: with one voter, the storyteller cannot score under the current scoring rules.' : '');
  };

  const act = (action: () => Game) => {
    try {
      setError('');
      setGame(action());
      setSelected([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That move could not be completed.');
    }
  };

  const advanceDemoRound = () => {
    if (!game) return;
    if (displayOnly) {
      const channel = new BroadcastChannel('little-fables-demo');
      channel.postMessage({ type: 'advance-round-request' });
      channel.close();
      return;
    }
    act(() => nextRound(game));
    setClue('');
  };

  // The demo players act on their own so the local game can be played end to end.
  useEffect(() => {
    if (!game || game.phase === 'over' || game.phase === 'results') return;
    const timer = setTimeout(() => {
      try {
        let updated = game;
        const bots = updated.players.filter(player => player.id !== 'p0');
        const roundStoryteller = storyteller(updated);
        if (updated.phase === 'clue' && roundStoryteller.id !== 'p0') {
          updated = giveClue(updated, roundStoryteller.hand[0].id, 'Wonder');
        }
        if (updated.phase === 'submit') {
          for (const bot of bots) {
            if (bot.id === storyteller(updated).id || updated.submissions[bot.id]) continue;
            updated = submitCards(updated, bot.id, [bot.hand[0].id]);
          }
        }
        if (updated.phase === 'vote') {
          for (const bot of bots) {
            if (bot.id === storyteller(updated).id || updated.votes[bot.id] !== undefined) continue;
            const ownEntries = updated.entries.map((entry, index) => entry.ownerId === bot.id ? index : -1).filter(index => index >= 0);
            const eligible = updated.entries.map((_, index) => index).filter(index => !ownEntries.includes(index));
            const storyIndex = updated.entries.findIndex(entry => entry.isStoryteller);
            const alternatives = eligible.filter(index => index !== storyIndex);
            const vote = Math.random() < 0.48 ? storyIndex : alternatives[Math.floor(Math.random() * alternatives.length)] ?? eligible[0];
            updated = castVote(updated, bot.id, vote);
          }
        }
        setGame(updated);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'A demo player could not act.');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [game]);

  const chooseCard = (id: string) => setSelected(current => current.includes(id) ? current.filter(cardId => cardId !== id) : [id]);
  const submit = () => {
    if (!game || !me) return;
    act(() => game.phase === 'clue' ? giveClue(game, selected[0] ?? '', clue) : submitCards(game, me.id, selected));
    setClue('');
  };

  const playerStatus = (playerId: string) => {
    if (!game) return 'PLAYER';
    if (playerId === currentStoryteller?.id) return 'STORYTELLER';
    if (game.phase === 'submit') return game.submissions[playerId] ? 'CARD READY' : 'CHOOSING';
    if (game.phase === 'vote') return game.votes[playerId] !== undefined ? 'VOTE LOCKED' : 'CHOOSING';
    if (game.phase === 'results' || game.phase === 'over') return 'ROUND SCORE';
    return 'PLAYER';
  };

  const roundLabel = game ? `ROUND ${String(game.round).padStart(2, '0')}` : '';
  const clueEntryAllowed = clue.trim().length > 0 && !/\s/.test(clue.trim());
  const roundTotals = game?.summary ?? [];
  const leaders = game ? game.players.filter(player => player.score === Math.max(...game.players.map(candidate => candidate.score))) : [];

  if (new URLSearchParams(window.location.search).get('online') === '1') {
    const params = new URLSearchParams(window.location.search);
    return <OnlineRoom initialCode={params.get('room') ?? ''} initialRole={params.get('role') ?? ''} onBack={() => { window.location.href = window.location.pathname; }} />;
  }

  // Keep demo views in sync across tabs in this browser. Each screen still renders
  // only its own view; remote devices need a configured room backend.
  useEffect(() => {
    const channel = new BroadcastChannel('little-fables-demo');
    channel.onmessage = event => {
      if (event.data?.type === 'game') { setGame(event.data.game); setShowLobby(false); }
      if (event.data?.type === 'advance-round-request' && !displayOnly) {
        if (!game || game.phase !== 'results') return;
        try {
          setGame(nextRound(game));
          setError('');
          setSelected([]);
          setClue('');
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Could not start the next round. Please try again.');
        }
      }
    };
    return () => channel.close();
  }, [displayOnly, game]);
  useEffect(() => {
    if (!game || displayOnly) return;
    try { localStorage.setItem('little-fables-demo-game', JSON.stringify(game)); } catch { /* storage may be unavailable */ }
    const channel = new BroadcastChannel('little-fables-demo');
    channel.postMessage({ type: 'game', game });
    channel.close();
  }, [game]);

  useEffect(() => {
    try { const saved = localStorage.getItem('little-fables-demo-game'); if (saved && !game) { setGame(JSON.parse(saved) as Game); setShowLobby(false); } } catch { /* ignore invalid local demo state */ }
  }, [game]);

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setShowLobby(true); setGame(null); }} aria-label="Little Fables home">
        <span className="brand-mark"><Sparkles size={18}/></span><span>little <b>fables</b></span>
      </a>
      <div className="top-actions"><span className="demo-badge"><span/> {displayOnly ? 'SHARED DISPLAY' : 'LOCAL TABLE'}</span>{game && !displayOnly && <a className="online-link" href="?view=display" target="_blank" rel="noreferrer">Open shared display</a>}{displayOnly && <a className="online-link" href="?view=player">Player view</a>}<button className="icon-button" onClick={() => setHelp(value => !value)} aria-label="How to play"><CircleHelp size={20}/></button></div>
    </header>

    {(!game || (showLobby && !displayOnly)) ? <section className="welcome">
      <div className="welcome-left">
        <div className="eyebrow"><span className="eyebrow-line"/> ONE-WORD STORY GAME</div>
        <h1>Every card<br/>holds a <em>little</em><br/>secret.</h1>
        <p className="welcome-copy">Give a one-word clue. Find the story hiding in someone else’s card.</p>
        <label className="field-label" htmlFor="player-name">YOUR NAME</label>
        <input id="player-name" className="name-input" value={name} maxLength={20} onChange={event => setName(event.target.value)} placeholder="Type your name"/>
        <label className="field-label count-label" htmlFor="player-count">PLAYERS AT THE TABLE</label>
        <select id="player-count" className="name-input player-count" value={playerCount} onChange={event => setPlayerCount(Number(event.target.value))}>
          {Array.from({ length: 7 }, (_, index) => index + 2).map(count => <option key={count} value={count}>{count} players</option>)}
        </select>
        <button className="primary start-button" onClick={start}><span>Take your seat</span><ArrowRight size={18}/></button>
        <button className="gallery-link" onClick={() => setGallery(true)}><Eye size={15}/> Browse all 84 illustrated cards</button>
        <button className="online-link" onClick={() => { window.location.href = `${window.location.pathname}?online=1`; }}><Users size={15}/> Online rooms</button>
        {error && <p className="inline-error">{error}</p>}
        {demoNotice&&<p className="test-notice">{demoNotice}</p>}
        <div className="welcome-foot"><span><Users size={15}/> 2–8 players</span><span><Heart size={14}/> One word, one card</span></div>
      </div>
      <div className="welcome-art" aria-label="Dreamlike illustrated cards on a dark table">
        <div className="orbital orbit-one"/><div className="orbital orbit-two"/><div className="moon">☾</div>
        <div className="float-card card-a"><span>✧</span><i>the<br/>quiet<br/>between</i></div>
        <div className="float-card card-b"><span>❋</span><i>a map<br/>of places<br/>we’ve been</i></div>
        <div className="float-card card-c"><span>☼</span><i>somewhere<br/>soft to<br/>land</i></div>
        <div className="tiny-stars">✦　 ·　✧<br/>　·　 ✦</div><div className="art-caption">a world made<br/>of what you see</div>
      </div>
    </section> : displayOnly ? <>
      <section className="game-head">
        <div><div className="eyebrow"><span className="eyebrow-line"/> {roundLabel} · SHARED TABLE</div><h1 className="game-title">A new story unfolds.</h1>
          <p className="turn-line">{currentStoryteller?.name} is the storyteller · {game.phase === 'vote' ? 'Voting is open' : game.phase === 'results' || game.phase === 'over' ? 'Round revealed' : game.phase === 'submit' ? 'Cards are being chosen' : 'Choosing a clue'}</p>
        </div><div className="round-chip"><Feather size={15}/><span>STORY {game.round}</span></div>
      </section>
      <section className="spectator-layout">
        <div className="phase-panel spectator-panel">
          <div className="phase-heading"><span className="phase-number">{game.phase === 'vote' ? '03' : 'TABLE'}</span><div><h2>{game.phase === 'vote' ? 'Choose the story card' : game.phase === 'results' || game.phase === 'over' ? 'The table reveals its story' : `${currentStoryteller?.name} is telling a story`}</h2><p>{game.phase === 'vote' ? 'Cards are anonymous until every vote is locked.' : 'This shared screen never shows a player’s hand or private choice.'}</p></div></div>
          {game.clue && <div className="clue-banner"><span>ONE-WORD CLUE</span><strong>{game.clue}</strong></div>}
          {game.phase === 'vote' && <div className="display-grid">{game.entries.map((entry, index) => <div className="display-card-wrap" key={entry.card.id}><span className="card-number">{String(index + 1).padStart(2, '0')}</span><CardArt card={entry.card} disabled label={`Anonymous card ${index + 1}`}/></div>)}</div>}
          {(game.phase === 'results' || game.phase === 'over') && <><div className="result-cards">{game.entries.map((entry, index) => <div className={`result-card ${entry.isStoryteller ? 'correct-card' : ''}`} key={entry.card.id}><span className="card-number">{String(index + 1).padStart(2, '0')}</span><CardArt card={entry.card} small disabled/><span>{entry.isStoryteller ? 'Storyteller’s card' : game.players.find(player => player.id === entry.ownerId)?.name}</span><small>{Object.values(game.votes).filter(vote => vote === index).length} votes</small></div>)}</div><div className="summary"><div className="summary-head"><span>ROUND SCORE BREAKDOWN</span><span>POINTS</span></div>{roundTotals.map(item => <div className="summary-row" key={item.playerId}><span className="summary-name">{item.playerName}</span><span className="summary-detail"><span>{item.note}</span><small>{item.base} base + {item.bonus} bonus · {item.receivedVotes} vote{item.receivedVotes === 1 ? '' : 's'} on their card</small></span><b>+{item.total}</b></div>)}</div>{game.phase === 'results' && <button className="primary next-button" onClick={advanceDemoRound}>Next storyteller <ArrowRight size={16}/></button>}{displayOnly && game.phase === 'results' && <p className="spectator-wait">This advances the player tab and shared display together.</p>}</>}
          {game.phase === 'clue' && <p className="spectator-wait">Waiting for the storyteller’s clue…</p>}{game.phase === 'submit' && <p className="spectator-wait">Players are choosing cards in private…</p>}{game.phase === 'vote' && <p className="spectator-wait">Votes are hidden until everyone has voted.</p>}
        </div>
        <aside className="sidebar"><div className="table-card"><div className="table-card-head"><span><Users size={15}/> AT THE TABLE</span><span>{game.players.length} PLAYERS</span></div>{game.players.map((player, index) => <div className={`player-row ${player.id === currentStoryteller?.id ? 'story-player' : ''}`} key={player.id}><span className="avatar" style={{ '--avatar': ['#e6a98d', '#b9a9e4', '#b8d58a', '#80c3b4', '#e8d35e', '#cf7c9a', '#9db9ed', '#d3a7d8'][index] } as React.CSSProperties}>{player.name.slice(0, 1).toUpperCase()}</span><span className="player-name">{player.name}<small>{playerStatus(player.id)}</small></span>{player.id === currentStoryteller?.id && <Crown size={15} className="crown"/>}<b>{player.score}</b></div>)}<div className="score-note">First to 30 points wins</div></div></aside>
      </section>
    </> : <>
      <section className="game-head">
        <div><div className="eyebrow"><span className="eyebrow-line"/> {roundLabel}</div><h1 className="game-title">A new story unfolds.</h1>
          <p className="turn-line">{currentStoryteller?.name} is the storyteller{game.lastStoryteller ? ` · ${game.lastStoryteller} told the last story` : ''}</p>
        </div>
        <div className="round-chip"><Feather size={15}/><span>STORY {game.round}</span></div>
      </section>

      <section className="table-layout">
        <div className="play-area">
          {game.phase === 'clue' && isStoryteller && <div className="phase-panel clue-panel">
            <div className="phase-heading"><span className="phase-number">01</span><div><h2>Set the table’s story</h2><p>Choose one card and give it exactly one word. Keep your card secret.</p></div></div>
            <div className="hand-row">{myHand.map(card => <CardArt key={card.id} card={card} selected={selected.includes(card.id)} onClick={() => chooseCard(card.id)}/>)}</div>
            <div className="clue-controls"><label className="sr-only" htmlFor="clue">Your one-word clue</label>
              <input id="clue" className="clue-input" value={clue} maxLength={36} placeholder="One word…" onChange={event => { const value = event.target.value; if (!/\s/.test(value)) setClue(value); }} onKeyDown={event => { if (/\s/.test(event.key)) event.preventDefault(); if (event.key === 'Enter') submit(); }}/>
              <button className="primary" disabled={!selected.length || !clueEntryAllowed} onClick={submit}>Share clue <ArrowRight size={16}/></button>
            </div>
          </div>}

          {game.phase === 'clue' && !isStoryteller && <div className="waiting-card"><div className="waiting-icon"><Feather/></div><p className="eyebrow">STORYTELLER’S TURN</p><h2>{currentStoryteller?.name} is choosing a card</h2><p>A one-word clue is on its way.</p><div className="waiting-dots"><i/><i/><i/></div></div>}

          {game.phase === 'submit' && <div className="phase-panel">
            <div className="phase-heading"><span className="phase-number">02</span><div><h2>Choose a card for the clue</h2><p>Pick one card that connects to the word.</p></div></div>
            <div className="clue-banner"><span>ONE-WORD CLUE</span><strong>{game.clue}</strong><Volume2 size={17}/></div>
            {!isStoryteller ? <><div className="hand-row">{myHand.map(card => <CardArt key={card.id} card={card} selected={selected.includes(card.id)} onClick={() => chooseCard(card.id)}/>)}</div>
              <div className="action-row"><span>{selected.length ? '1 card selected' : 'Tap a card to select it'}</span><button className="primary" disabled={!selected.length} onClick={submit}>Submit card <ArrowRight size={16}/></button></div></>
              : <div className="waiting-card compact"><div className="waiting-icon"><Users/></div><h2>Cards are coming in</h2><p>Everyone is choosing one card in secret.</p></div>}
          </div>}

          {game.phase === 'vote' && <div className="phase-panel vote-panel">
            <div className="phase-heading"><span className="phase-number">03</span><div><h2>Who chose the story card?</h2><p>Tap a card to lock in your secret vote. Your own card is disabled.</p></div></div>
            <div className="clue-banner"><span>THE CLUE</span><strong>{game.clue}</strong><Volume2 size={17}/></div>
            <div className="display-grid">{game.entries.map((entry, index) => {
              const ownCard = entry.ownerId === me?.id;
              const voteLocked = game.votes[me?.id ?? ''] !== undefined;
              return <div className="display-card-wrap" key={entry.card.id}><span className="card-number">{String(index + 1).padStart(2, '0')}</span>
                <CardArt card={entry.card} selected={game.votes[me?.id ?? ''] === index} disabled={isStoryteller || ownCard || voteLocked}
                  onClick={() => { if (!isStoryteller && !ownCard && !voteLocked && me) act(() => castVote(game, me.id, index)); }}
                  label={`Card ${index + 1}${ownCard ? ', your card, cannot vote' : voteLocked ? ', vote locked' : ', vote for this card'}`}/>
              </div>;
            })}</div>
            <div className="vote-wait"><Eye size={16}/>{isStoryteller ? 'Votes stay secret until everyone has chosen' : game.votes[me?.id ?? ''] !== undefined ? 'Your vote is locked in and hidden' : 'Your vote stays hidden until the table is ready'}</div>
          </div>}

          {game.phase === 'results' && <div className="phase-panel results-panel">
            <div className="phase-heading"><span className="phase-number">04</span><div><h2>The table reveals its story</h2><p>Cards and votes are now public. Here’s how everyone scored.</p></div></div>
            <div className="clue-banner"><span>THE CLUE</span><strong>{game.clue}</strong><Volume2 size={17}/></div>
            <div className="result-cards">{game.entries.map((entry, index) => <div className={`result-card ${entry.isStoryteller ? 'correct-card' : ''}`} key={entry.card.id}>
              <span className="card-number">{String(index + 1).padStart(2, '0')}</span><CardArt card={entry.card} small/>
              <span>{entry.isStoryteller ? 'Storyteller’s card' : game.players.find(player => player.id === entry.ownerId)?.name}</span>
              <small>{Object.values(game.votes).filter(vote => vote === index).length} votes</small>
            </div>)}</div>
            <div className="summary"><div className="summary-head"><span>ROUND SCORE BREAKDOWN</span><span>POINTS</span></div>
              {roundTotals.map(item => <div className="summary-row" key={item.playerId}>
                <span className="summary-name">{item.playerId === currentStoryteller?.id && <Crown size={14}/>} {item.playerName}</span>
                <span className="summary-detail"><span>{item.note}</span><small>{item.base} base + {item.bonus} bonus · {item.receivedVotes} vote{item.receivedVotes === 1 ? '' : 's'} on their card</small></span>
                <b>+{item.total}</b>
              </div>)}
            </div>
            <button className="primary next-button" onClick={advanceDemoRound}>Next storyteller <ArrowRight size={16}/></button>
          </div>}

          {game.phase === 'over' && <div className="phase-panel over-panel">
            <div className="waiting-icon"><Crown/></div><p className="eyebrow">THAT’S A WRAP</p><h2>{leaders.map(player => player.name).join(' & ')} {leaders.length > 1 ? 'share' : 'wins'} the story.</h2>
            <p>Thirty points reached. Here is the final round’s score breakdown.</p>
            <div className="final-score-list">{[...game.players].sort((a, b) => b.score - a.score).map((player, index) => <div key={player.id}><span>{index === 0 ? '✦ ' : ''}{player.name}</span><b>{player.score}</b></div>)}</div>
            <div className="summary final-summary"><div className="summary-head"><span>FINAL ROUND POINTS</span><span>POINTS</span></div>{roundTotals.map(item => <div className="summary-row" key={item.playerId}>
              <span className="summary-name">{item.playerName}</span><span className="summary-detail"><span>{item.note}</span><small>{item.base} base + {item.bonus} bonus · {item.receivedVotes} vote{item.receivedVotes === 1 ? '' : 's'} on their card</small></span><b>+{item.total}</b>
            </div>)}</div>
            <button className="primary" onClick={start}>Play again <RefreshCw size={16}/></button>
          </div>}
        </div>

        <aside className="sidebar">
          <div className="table-card"><div className="table-card-head"><span><Users size={15}/> AT THE TABLE</span><span>{game.players.length} PLAYERS</span></div>
            {game.players.map((player, index) => <div className={`player-row ${player.id === currentStoryteller?.id ? 'story-player' : ''}`} key={player.id}>
              <span className="avatar" style={{ '--avatar': ['#e6a98d', '#b9a9e4', '#b8d58a', '#80c3b4', '#e8d35e', '#cf7c9a', '#9db9ed', '#d3a7d8'][index] } as React.CSSProperties}>{player.name.slice(0, 1).toUpperCase()}</span>
              <span className="player-name">{player.name}{player.id === 'p0' ? ' (you)' : ''}<small>{playerStatus(player.id)}</small></span>
              {player.id === currentStoryteller?.id && <Crown size={15} className="crown"/>}<b>{player.score}</b>
            </div>)}
            <div className="score-note">First to 30 points wins</div>
          </div>
          <div className="tip-card"><Sparkles size={16}/><p><b>One word.</b> Leave room for a little imagination.</p></div>
          <button className="deck-link" onClick={() => setGallery(true)}><Eye size={15}/> Browse the 84-card deck</button>
          <button className="leave-button" onClick={() => { setGame(null); setShowLobby(true); }}><ArrowLeft size={15}/> Leave this story</button>
        </aside>
      </section>
    </>}

    {gallery && <div className="help-backdrop gallery-backdrop" role="presentation" onClick={() => setGallery(false)}>
      <section className="gallery-modal" role="dialog" aria-modal="true" aria-labelledby="gallery-title" onClick={event => event.stopPropagation()}>
        <button className="icon-button close-help" onClick={() => setGallery(false)} aria-label="Close card gallery">×</button>
        <p className="eyebrow">FULL ILLUSTRATED DECK</p><h2 id="gallery-title">84 little worlds</h2>
        <p className="gallery-intro">Every image is in the draw deck. Cards are dealt at random; the gallery lets you browse the complete set.</p>
        <div className="gallery-grid">{artPreviewCards.map(card => <figure className="gallery-item" key={card.id}><CardArt card={card}/><figcaption>{card.title}</figcaption></figure>)}</div>
      </section>
    </div>}
    {help && <div className="help-backdrop" role="presentation" onClick={() => setHelp(false)}>
      <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}>
        <button className="icon-button close-help" onClick={() => setHelp(false)} aria-label="Close help">×</button>
        <p className="eyebrow">A QUICK GUIDE</p><h2 id="help-title">How to play</h2>
        <ol><li>Everyone starts with six cards.</li><li>The storyteller picks a card and gives exactly one word as a clue.</li><li>Everyone else submits one card. Then each non-storyteller secretly votes.</li><li>Reveal votes, score the round, draw one card, and pass the storyteller role.</li></ol>
        <p>If everyone finds the storyteller’s card or nobody does, other players score 2. Otherwise, the storyteller and correct guessers score 3. Cards also earn one point per vote received. First to 30 wins.</p>
        <button className="primary" onClick={() => setHelp(false)}>Got it <Check size={16}/></button>
      </section>
    </div>}
    <footer className="footer"><span>Little Fables <i>·</i> an original story-card game prototype</span><span>One-word clue rules</span></footer>
  </main>;
}
