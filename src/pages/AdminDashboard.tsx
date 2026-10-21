import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Gamepad2, LogOut, Mail, RefreshCw, ShieldCheck, ToggleLeft, ToggleRight, Trophy, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Profile = { user_id: string; display_name: string; avatar: string; created_at: string };
type History = { id: string; user_id: string; game_key: string; score: number; won: boolean; played_at: string };
type GameControl = { game_key: string; enabled: boolean };
const GAME_NAMES: Record<string,string> = { imposter:'Imposter', family_trivia:'Family Trivia', picture_clues:'Picture Clues', push_your_luck:'Push Your Luck', charades:'Charades', draw_guess:'Draw & Guess', word_spy:'Word Spy', railway_rush:'Railway Rush' };

export default function AdminDashboard() {
  const [email,setEmail] = useState('');
  const [userId,setUserId] = useState<string|null>(null);
  const [isAdmin,setIsAdmin] = useState(false);
  const [checking,setChecking] = useState(true);
  const [message,setMessage] = useState('');
  const [profiles,setProfiles] = useState<Profile[]>([]);
  const [history,setHistory] = useState<History[]>([]);
  const [games,setGames] = useState<GameControl[]>([]);
  const [busy,setBusy] = useState('');
  const [query,setQuery] = useState('');
  const [tab,setTab] = useState<'overview'|'players'|'games'>('overview');

  const loadData = async () => {
    if (!supabase) { setMessage('Supabase is not configured in this deployment.'); return; }
    const [p,h,g] = await Promise.all([
      supabase.from('profiles').select('user_id,display_name,avatar,created_at').order('created_at',{ascending:false}),
      supabase.from('game_history').select('id,user_id,game_key,score,won,played_at').order('played_at',{ascending:false}).limit(500),
      supabase.from('game_controls').select('game_key,enabled').order('game_key')
    ]);
    if(p.error || h.error || g.error) { setMessage('Could not load admin data. Confirm supabase/admin_schema.sql was run and your account is listed in admin_users.'); return; }
    setProfiles((p.data||[]) as Profile[]); setHistory((h.data||[]) as History[]); setGames((g.data||[]) as GameControl[]); setMessage('');
  };

  useEffect(() => {
    let alive = true;
    const init = async () => {
      if (!supabase) { if(alive){setChecking(false);setMessage('Supabase is not configured in this deployment.');} return; }
      const {data:{session}} = await supabase.auth.getSession();
      if(!alive) return;
      if(session?.user) {
        setUserId(session.user.id);
        const {data,error} = await supabase.from('admin_users').select('user_id').eq('user_id',session.user.id).maybeSingle();
        if(!alive) return;
        if(!error && data) { setIsAdmin(true); await loadData(); }
        else setMessage('This account is not authorized as an admin. Add its user UUID to public.admin_users using the Supabase SQL Editor.');
      }
      setChecking(false);
    };
    void init();
    const {data:{subscription}} = supabase?.auth.onAuthStateChange(() => { void init(); }) ?? {data:{subscription:{unsubscribe:()=>{}}}};
    return () => {alive=false;subscription.unsubscribe();};
  }, []);

  const sendLink = async () => {
    if(!supabase || !email.trim()) return;
    setBusy('login'); setMessage('');
    const {error} = await supabase.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.origin+window.location.pathname}});
    setMessage(error ? error.message : 'Magic sign-in link sent. Open it from this browser, then return to /admin.');
    setBusy('');
  };
  const toggleGame = async (game:GameControl) => {
    if(!supabase || !isAdmin) return;
    setBusy(game.game_key);
    const {error} = await supabase.from('game_controls').update({enabled:!game.enabled}).eq('game_key',game.game_key);
    if(error) setMessage('Could not change game availability. Check admin policies.');
    else setGames(old=>old.map(g=>g.game_key===game.game_key?{...g,enabled:!g.enabled}:g));
    setBusy('');
  };
  const playerRows = useMemo(()=>profiles.filter(p=>p.display_name.toLowerCase().includes(query.toLowerCase())),[profiles,query]);
  const gamesPlayed = history.length;
  const totalScore = history.reduce((n,h)=>n+h.score,0);
  const topPlayers = useMemo(()=>profiles.map(p=>({...p,plays:history.filter(h=>h.user_id===p.user_id).length,score:history.filter(h=>h.user_id===p.user_id).reduce((n,h)=>n+h.score,0)})).sort((a,b)=>b.score-a.score).slice(0,5),[profiles,history]);
  if(checking) return <div className="admin-shell"><div className="admin-card">Checking admin access…</div></div>;
  if(!isAdmin) return <div className="admin-shell"><a className="admin-back" href="/Uni-Game/"><ArrowLeft size={16}/> Back to Gather</a><section className="admin-login"><div className="admin-brand"><ShieldCheck size={24}/> GATHER <span>ADMIN</span></div><h1>Control room.</h1><p>Sign in with your authorized admin email. Admin access is granted only to accounts registered in the database.</p><label className="field-label">ADMIN EMAIL<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@example.com"/></label><button className="btn btn-primary full-btn" disabled={!email.trim()||busy==='login'} onClick={()=>void sendLink()}><Mail size={16}/> {busy==='login'?'Sending link…':'Send sign-in link'}</button>{userId&&<small className="admin-hint">Signed-in user ID: {userId}. If not authorized, add this UUID to public.admin_users in Supabase.</small>}{message&&<p className="admin-message">{message}</p>}</section></div>;
  return <div className="admin-shell"><header className="admin-top"><a className="brand" href="/Uni-Game/"><span className="brand-mark"><Gamepad2 size={20}/></span> gather<span className="brand-dot">.</span></a><div className="admin-top-right"><span className="admin-chip"><ShieldCheck size={14}/> Admin</span><button className="btn btn-quiet" onClick={()=>void loadData()}><RefreshCw size={15}/> Refresh</button><button className="btn btn-quiet" onClick={()=>void supabase?.auth.signOut()}><LogOut size={15}/> Sign out</button></div></header><main className="admin-main"><div className="admin-heading"><div><div className="eyebrow">GATHER OPERATIONS</div><h1>Control room<span>.</span></h1><p>Player activity, game performance, and availability controls.</p></div><span className="admin-live"><i/> Connected</span></div>{message&&<div className="admin-message">{message}</div>}<nav className="admin-tabs">{(['overview','players','games'] as const).map(t=><button key={t} className={tab===t?'selected':''} onClick={()=>setTab(t)}>{t==='overview'?<BarChart3 size={16}/>:t==='players'?<Users size={16}/>:<Gamepad2 size={16}/>} {t[0].toUpperCase()+t.slice(1)}</button>)}</nav>{tab==='overview'&&<><div className="admin-metrics"><article><Users/><span>Total players</span><strong>{profiles.length}</strong><small>Saved profiles</small></article><article><Gamepad2/><span>Games played</span><strong>{gamesPlayed}</strong><small>Recorded sessions</small></article><article><Trophy/><span>Points recorded</span><strong>{totalScore.toLocaleString()}</strong><small>Across recent history</small></article><article><ToggleRight/><span>Available games</span><strong>{games.filter(g=>g.enabled).length}<small> / {games.length}</small></strong><small>Toggle availability below</small></article></div><section className="admin-panel"><div className="admin-panel-title"><div><h2>Leaderboard</h2><p>Top players by recorded points</p></div><button className="text-link" onClick={()=>setTab('players')}>All players →</button></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>PLAYER</th><th>GAMES</th><th>TOTAL SCORE</th></tr></thead><tbody>{topPlayers.map((p,i)=><tr key={p.user_id}><td><span className="admin-player"><b>{p.avatar}</b><span>{p.display_name}<small>{i===0?'Top scorer': 'Player profile'}</small></span></span></td><td>{p.plays}</td><td className="score-cell">{p.score.toLocaleString()}</td></tr>)}{!topPlayers.length&&<tr><td colSpan={3}>No player profiles yet. They will appear after players sign in.</td></tr>}</tbody></table></div></section><section className="admin-panel"><div className="admin-panel-title"><div><h2>Game availability</h2><p>Turn a game on or off for the public lobby</p></div><button className="text-link" onClick={()=>setTab('games')}>Manage games →</button></div><div className="admin-game-list">{games.map(g=><div className="admin-game-row" key={g.game_key}><span><b>{GAME_NAMES[g.game_key]||g.game_key}</b><small>{history.filter(h=>h.game_key===g.game_key).length} recorded plays</small></span><button className={'admin-toggle '+(g.enabled?'on':'')} onClick={()=>void toggleGame(g)} disabled={busy===g.game_key} aria-label={'Toggle '+g.game_key}>{g.enabled?<ToggleRight/>:<ToggleLeft/>}<span>{g.enabled?'Enabled':'Disabled'}</span></button></div>)}</div></section></>}{tab==='players'&&<section className="admin-panel"><div className="admin-panel-title"><div><h2>Player directory</h2><p>{profiles.length} registered guest profiles</p></div><input className="admin-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search players…"/></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>PLAYER</th><th>GAMES PLAYED</th><th>TOTAL SCORE</th><th>LAST PLAYED</th></tr></thead><tbody>{playerRows.map(p=>{const rows=history.filter(h=>h.user_id===p.user_id);return <tr key={p.user_id}><td><span className="admin-player"><b>{p.avatar}</b><span>{p.display_name}<small>{p.user_id.slice(0,8)}…</small></span></span></td><td>{rows.length}</td><td className="score-cell">{rows.reduce((n,h)=>n+h.score,0).toLocaleString()}</td><td>{rows[0]?new Date(rows[0].played_at).toLocaleDateString():'—'}</td></tr>})}{!playerRows.length&&<tr><td colSpan={4}>No matching players.</td></tr>}</tbody></table></div></section>}{tab==='games'&&<section className="admin-panel"><div className="admin-panel-title"><div><h2>Game controls</h2><p>Disabled games are hidden from the player lobby.</p></div></div><div className="admin-game-list">{games.map(g=><div className="admin-game-row" key={g.game_key}><span><b>{GAME_NAMES[g.game_key]||g.game_key}</b><small>{history.filter(h=>h.game_key===g.game_key).length} recorded plays</small></span><button className={'admin-toggle '+(g.enabled?'on':'')} onClick={()=>void toggleGame(g)} disabled={busy===g.game_key}>{g.enabled?<ToggleRight/>:<ToggleLeft/>}<span>{g.enabled?'Enabled':'Disabled'}</span></button></div>)}</div></section>}<p className="admin-footnote">Scores and play counts reflect records written to <code>game_history</code>. Live sessions are not yet implemented.</p></main></div>;
}
