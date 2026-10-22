import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Gamepad2, LogOut, LockKeyhole, RefreshCw, Search, ShieldCheck, ToggleLeft, ToggleRight, Trophy, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './admin-account-management.css';

type Profile = { user_id: string; display_name: string; avatar: string; created_at: string };
type History = { id: string; user_id: string; game_key: string; score: number; won: boolean; played_at: string };
type GameControl = { game_key: string; enabled: boolean };
type Account = {
  user_id: string;
  email: string | null;
  display_name: string;
  avatar: string;
  created_at: string;
  is_banned: boolean;
  is_admin: boolean;
  ban_reason: string | null;
  is_deleted: boolean;
};
type AccountAudit = {
  id: number;
  actor_id: string;
  target_user_id: string;
  target_email: string | null;
  action: 'ban' | 'unban' | 'delete';
  reason: string | null;
  occurred_at: string;
  status: 'pending' | 'applied' | 'partial' | 'failed';
};
type AccountList = { accounts: Account[]; audit: AccountAudit[]; truncated: boolean };
type AdminTab = 'overview' | 'players' | 'accounts' | 'games';
type AccountAction = 'ban' | 'unban' | 'delete';

const GAME_NAMES: Record<string, string> = {
  imposter: 'Imposter',
  family_trivia: 'Family Trivia',
  picture_clues: 'Picture Clues',
  push_your_luck: 'Push Your Luck',
  charades: 'Charades',
  draw_guess: 'Draw & Guess',
  word_spy: 'Word Spy',
  railway_rush: 'Railway Rush',
};

async function functionErrorMessage(error: { context?: unknown } | null, fallback: string) {
  if (error?.context instanceof Response) {
    const payload = await error.context.json() as { error?: string };
    if (payload.error) return payload.error;
  }
  return fallback;
}

export default function AdminDashboard() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [games, setGames] = useState<GameControl[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [audit, setAudit] = useState<AccountAudit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<AdminTab>('overview');

  const loadData = async (accountQuery = '') => {
    if (!supabase) {
      setMessage('Supabase is not configured in this deployment.');
      return;
    }
    const [profileResult, historyResult, gameResult, accountResult] = await Promise.all([
      supabase.from('profiles').select('user_id,display_name,avatar,created_at').order('created_at', { ascending: false }),
      supabase.from('game_history').select('id,user_id,game_key,score,won,played_at').order('played_at', { ascending: false }).limit(500),
      supabase.from('game_controls').select('game_key,enabled').order('game_key'),
      supabase.functions.invoke<AccountList>('admin-accounts', { body: { action: 'list', query: accountQuery } }),
    ]);
    if (profileResult.error || historyResult.error || gameResult.error) {
      setMessage('Could not load admin data. Confirm the admin schema is installed and your account is listed in admin_users.');
      return;
    }
    if (accountResult.error) {
      setMessage(await functionErrorMessage(accountResult.error, 'Could not load player accounts. Deploy the admin-accounts function and apply its migration.'));
      return;
    }
    setProfiles((profileResult.data ?? []) as Profile[]);
    setHistory((historyResult.data ?? []) as History[]);
    setGames((gameResult.data ?? []) as GameControl[]);
    setAccounts(accountResult.data?.accounts ?? []);
    setAudit(accountResult.data?.audit ?? []);
    setTruncated(accountResult.data?.truncated ?? false);
    setMessage('');
  };

  useEffect(() => {
    let alive = true;
    const init = async () => {
      if (!supabase) {
        if (alive) {
          setChecking(false);
          setMessage('Supabase is not configured in this deployment.');
        }
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      if (session?.user) {
        setUserId(session.user.id);
        const { data, error } = await supabase.from('admin_users').select('user_id').eq('user_id', session.user.id).maybeSingle();
        if (!alive) return;
        if (!error && data) {
          setIsAdmin(true);
          await loadData();
        } else {
          setMessage('This account is not authorized as an admin. Add its user UUID to public.admin_users using the Supabase SQL Editor.');
        }
      } else {
        setIsAdmin(false);
      }
      if (alive) setChecking(false);
    };
    void init();
    const { data: { subscription } } = supabase?.auth.onAuthStateChange(() => { void init(); }) ?? { data: { subscription: { unsubscribe: () => undefined } } };
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setInterval(() => { void loadData(query); }, 10000);
    return () => window.clearInterval(timer);
  }, [isAdmin, query]);

  const signIn = async () => {
    if (!supabase || !email.trim() || !password) return;
    setBusy('login');
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMessage('Sign-in failed. Check your email and password. Only an account added to admin_users can open the dashboard.');
    else setMessage('Credentials accepted. Checking administrator permissions…');
    setBusy('');
  };

  const toggleGame = async (game: GameControl) => {
    if (!supabase || !isAdmin) return;
    setBusy(game.game_key);
    const { error } = await supabase.from('game_controls').update({ enabled: !game.enabled }).eq('game_key', game.game_key);
    if (error) setMessage('Could not change game availability. Check admin policies.');
    else setGames(old => old.map(item => item.game_key === game.game_key ? { ...item, enabled: !game.enabled } : item));
    setBusy('');
  };

  const manageAccount = async (account: Account, action: AccountAction) => {
    if (!supabase || !isAdmin || account.is_admin || account.is_deleted) return;
    const label = account.email || account.user_id;
    if (action === 'delete') {
      if (!window.confirm(`Permanently delete ${label}? This removes the Auth account, profile, and associated game history. Audit records are retained.`)) return;
      if (window.prompt('Type DELETE to confirm permanent account deletion.') !== 'DELETE') return;
    } else if (!window.confirm(`${action === 'ban' ? 'Ban' : 'Unban'} ${label}?`)) {
      return;
    }
    const reason = action === 'ban'
      ? window.prompt('Reason for this ban (required):')?.trim() ?? ''
      : action === 'delete'
        ? window.prompt('Optional reason for the deletion:')?.trim() ?? ''
        : '';
    if (action === 'ban' && !reason) {
      setMessage('A reason is required to ban an account.');
      return;
    }
    setBusy(account.user_id);
    setMessage('');
    const { data, error } = await supabase.functions.invoke<{ success?: boolean; warning?: string; error?: string }>('admin-accounts', {
      body: { action, target_user_id: account.user_id, reason },
    });
    if (error) {
      setMessage(await functionErrorMessage(error, 'The account action failed. Check the Edge Function deployment and administrator access.'));
    } else if (!data?.success) {
      setMessage(data?.error || 'The account action failed.');
    } else {
      setMessage(data.warning || `${action === 'delete' ? 'Account deleted' : action === 'ban' ? 'Account banned' : 'Account unbanned'} successfully.`);
      await loadData(query);
    }
    setBusy('');
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadData(query);
  };
  const gamesPlayed = history.length;
  const totalScore = history.reduce((sum, row) => sum + row.score, 0);
  const topPlayers = useMemo(
    () => profiles.map(profile => ({
      ...profile,
      plays: history.filter(row => row.user_id === profile.user_id).length,
      score: history.filter(row => row.user_id === profile.user_id).reduce((sum, row) => sum + row.score, 0),
    })).sort((a, b) => b.score - a.score).slice(0, 5),
    [profiles, history],
  );

  if (checking) return <div className="admin-shell"><div className="admin-card">Checking admin access…</div></div>;
  if (!isAdmin) {
    return (
      <div className="admin-shell">
        <a className="admin-back" href="/Uni-Game/"><ArrowLeft size={16} /> Back to Gather</a>
        <section className="admin-login">
          <div className="admin-brand"><ShieldCheck size={24} /> GATHER <span>ADMIN</span></div>
          <h1>Admin sign in.</h1>
          <p>Use your administrator email and password. Authentication alone is not enough: your account must also be authorized in the admin_users table.</p>
          <form onSubmit={event => { event.preventDefault(); void signIn(); }}>
            <label className="field-label">ADMIN EMAIL<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="admin@example.com" /></label>
            <label className="field-label">PASSWORD<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" /></label>
            <button className="btn btn-primary full-btn" type="submit" disabled={!email.trim() || !password || busy === 'login'}><LockKeyhole size={16} /> {busy === 'login' ? 'Signing in…' : 'Sign in securely'}</button>
          </form>
          {userId && <small className="admin-hint">Signed-in user ID: {userId}. If not authorized, add this UUID to public.admin_users in Supabase.</small>}
          {message && <p className="admin-message">{message}</p>}
          <p className="admin-hint">Create or reset the administrator password in Supabase → Authentication → Users. Do not put passwords in source code or GitHub.</p>
        </section>
      </div>
    );
  }

  const tabs: AdminTab[] = ['overview', 'players', 'accounts', 'games'];
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <a className="brand" href="/Uni-Game/"><span className="brand-mark"><Gamepad2 size={20} /></span> gather<span className="brand-dot">.</span></a>
        <div className="admin-top-right">
          <span className="admin-chip"><ShieldCheck size={14} /> Admin</span>
          <button className="btn btn-quiet" onClick={() => void loadData(query)}><RefreshCw size={15} /> Refresh</button>
          <button className="btn btn-quiet" onClick={() => void supabase?.auth.signOut()}><LogOut size={15} /> Sign out</button>
        </div>
      </header>
      <main className="admin-main">
        <div className="admin-heading">
          <div><div className="eyebrow">GATHER OPERATIONS</div><h1>Control room<span>.</span></h1><p>Player activity, game performance, and availability controls.</p></div>
          <span className="admin-live"><i /> Connected</span>
        </div>
        {message && <div className="admin-message">{message}</div>}
        <nav className="admin-tabs">
          {tabs.map(item => (
            <button key={item} className={tab === item ? 'selected' : ''} onClick={() => setTab(item)}>
              {item === 'overview' ? <BarChart3 size={16} /> : item === 'games' ? <Gamepad2 size={16} /> : <Users size={16} />}
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <>
            <div className="admin-metrics">
              <article><Users /><span>Total players</span><strong>{profiles.length}</strong><small>Saved profiles</small></article>
              <article><Gamepad2 /><span>Games played</span><strong>{gamesPlayed}</strong><small>Recorded sessions</small></article>
              <article><Trophy /><span>Points recorded</span><strong>{totalScore.toLocaleString()}</strong><small>Across recent history</small></article>
              <article><ToggleRight /><span>Available games</span><strong>{games.filter(game => game.enabled).length}<small> / {games.length}</small></strong><small>Toggle availability below</small></article>
            </div>
            <section className="admin-panel">
              <div className="admin-panel-title"><div><h2>Leaderboard</h2><p>Top players by recorded points</p></div><button className="text-link" onClick={() => setTab('players')}>All players →</button></div>
              <div className="admin-table-wrap"><table className="admin-table">
                <thead><tr><th>PLAYER</th><th>GAMES</th><th>TOTAL SCORE</th></tr></thead>
                <tbody>
                  {topPlayers.map((player, index) => <tr key={player.user_id}><td><span className="admin-player"><b>{player.avatar}</b><span>{player.display_name}<small>{index === 0 ? 'Top scorer' : 'Player profile'}</small></span></span></td><td>{player.plays}</td><td className="score-cell">{player.score.toLocaleString()}</td></tr>)}
                  {!topPlayers.length && <tr><td colSpan={3}>No player profiles yet. They will appear after players sign in.</td></tr>}
                </tbody>
              </table></div>
            </section>
            <section className="admin-panel">
              <div className="admin-panel-title"><div><h2>Game availability</h2><p>Turn a game on or off for the public lobby</p></div><button className="text-link" onClick={() => setTab('games')}>Manage games →</button></div>
              <div className="admin-game-list">{games.map(game => <div className="admin-game-row" key={game.game_key}><span><b>{GAME_NAMES[game.game_key] || game.game_key}</b><small>{history.filter(row => row.game_key === game.game_key).length} recorded plays</small></span><button className={'admin-toggle ' + (game.enabled ? 'on' : '')} onClick={() => void toggleGame(game)} disabled={busy === game.game_key} aria-label={'Toggle ' + game.game_key}>{game.enabled ? <ToggleRight /> : <ToggleLeft />}<span>{game.enabled ? 'Enabled' : 'Disabled'}</span></button></div>)}</div>
            </section>
          </>
        )}

        {tab === 'players' && (
          <section className="admin-panel">
            <div className="admin-panel-title"><div><h2>Player directory</h2><p>{profiles.length} saved profiles</p></div><button className="text-link" onClick={() => setTab('accounts')}>Manage accounts →</button></div>
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>PLAYER</th><th>GAMES PLAYED</th><th>TOTAL SCORE</th><th>LAST PLAYED</th></tr></thead>
              <tbody>{profiles.map(profile => {
                const rows = history.filter(row => row.user_id === profile.user_id);
                return <tr key={profile.user_id}><td><span className="admin-player"><b>{profile.avatar}</b><span>{profile.display_name}<small>{profile.user_id}</small></span></span></td><td>{rows.length}</td><td className="score-cell">{rows.reduce((sum, row) => sum + row.score, 0).toLocaleString()}</td><td>{rows[0] ? new Date(rows[0].played_at).toLocaleDateString() : '—'}</td></tr>;
              })}{!profiles.length && <tr><td colSpan={4}>No player profiles.</td></tr>}</tbody>
            </table></div>
          </section>
        )}

        {tab === 'accounts' && (
          <>
            <section className="admin-panel">
              <div className="admin-panel-title">
                <div><h2>Account management</h2><p>Search by email, display name, or user ID. Results are capped at 250.</p></div>
                <form className="admin-account-search" onSubmit={submitSearch}>
                  <input className="admin-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search accounts…" aria-label="Search by email, display name, or user ID" />
                  <button className="btn btn-quiet" type="submit"><Search size={15} /> Search</button>
                </form>
              </div>
              <div className="admin-table-wrap"><table className="admin-table">
                <thead><tr><th>PLAYER / ACCOUNT</th><th>STATUS</th><th>USER ID</th><th>ACTIONS</th></tr></thead>
                <tbody>{accounts.map(account => (
                  <tr key={account.user_id}>
                    <td><span className="admin-player"><b>{account.avatar}</b><span>{account.display_name}<small>{account.email || 'No email linked'}</small></span></span></td>
                    <td><span className={'account-status ' + (account.is_deleted ? 'deleted' : account.is_banned ? 'banned' : '')}>{account.is_deleted ? 'Deleted' : account.is_banned ? 'Banned' : 'Active'}</span>{account.is_admin && <span className="account-status"> Admin</span>}{account.is_banned && account.ban_reason && <small className="account-reason">{account.ban_reason}</small>}</td>
                    <td><code className="account-id">{account.user_id}</code></td>
                    <td className="account-actions">
                      {account.is_deleted ? <span className="account-muted">No Auth account</span> : account.is_admin
                        ? <span className="account-muted">Administrator protected</span>
                        : account.is_banned
                          ? <button className="btn btn-quiet" disabled={busy === account.user_id} onClick={() => void manageAccount(account, 'unban')}>Unban</button>
                          : <><button className="btn btn-quiet" disabled={busy === account.user_id} onClick={() => void manageAccount(account, 'ban')}>Ban</button><button className="btn btn-danger" disabled={busy === account.user_id} onClick={() => void manageAccount(account, 'delete')}>Delete</button></>}
                    </td>
                  </tr>
                ))}{!accounts.length && <tr><td colSpan={4}>No accounts match this search.</td></tr>}</tbody>
              </table></div>
              {truncated && <p className="admin-footnote">Only the newest 250 matching accounts are shown. Refine the search to find older accounts.</p>}
            </section>
            <section className="admin-panel">
              <div className="admin-panel-title"><div><h2>Account action history</h2><p>Recent actions remain available after an account is deleted.</p></div></div>
              <div className="admin-table-wrap"><table className="admin-table">
                <thead><tr><th>TIME</th><th>ACTION</th><th>TARGET</th><th>ACTOR ID</th><th>REASON / RESULT</th></tr></thead>
                <tbody>{audit.map(item => <tr key={item.id}><td>{new Date(item.occurred_at).toLocaleString()}</td><td>{item.action}</td><td>{item.target_email || item.target_user_id}<small className="account-id">{item.target_user_id}</small></td><td><code className="account-id">{item.actor_id}</code></td><td>{item.reason || '—'}<small className="account-reason">{item.status}</small></td></tr>)}{!audit.length && <tr><td colSpan={5}>No account actions recorded.</td></tr>}</tbody>
              </table></div>
            </section>
          </>
        )}

        {tab === 'games' && (
          <section className="admin-panel">
            <div className="admin-panel-title"><div><h2>Game controls</h2><p>Disabled games are hidden from the player lobby.</p></div></div>
            <div className="admin-game-list">{games.map(game => <div className="admin-game-row" key={game.game_key}><span><b>{GAME_NAMES[game.game_key] || game.game_key}</b><small>{history.filter(row => row.game_key === game.game_key).length} recorded plays</small></span><button className={'admin-toggle ' + (game.enabled ? 'on' : '')} onClick={() => void toggleGame(game)} disabled={busy === game.game_key}>{game.enabled ? <ToggleRight /> : <ToggleLeft />}<span>{game.enabled ? 'Enabled' : 'Disabled'}</span></button></div>)}</div>
          </section>
        )}
        <p className="admin-footnote">Scores and play counts reflect records written to <code>game_history</code>. Deleting an account cascades its profile and game history; account audit records are retained.</p>
      </main>
    </div>
  );
}
