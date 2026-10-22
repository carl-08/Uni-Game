import { useState } from 'react';
import { Check, CircleUserRound, LoaderCircle, Mail, Save, X } from 'lucide-react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';

const avatarChoices = ['🎮', '🦊', '🐸', '🐼', '🐙', '🦄', '🐯', '🐻'];

export default function PlayerProfileButton() {
  const { user, profile, loading, error, configured, saveProfile, linkGuestEmail, signInWithEmail } = usePlayerProfile();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🎮');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const show = () => {
    setName(profile?.display_name || '');
    setAvatar(profile?.avatar || '🎮');
    setNotice('');
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setNotice('');
    const ok = await saveProfile(name, avatar);
    setBusy(false);
    if (ok) {
      setNotice('Profile saved.');
      window.setTimeout(() => setOpen(false), 800);
    }
  };

  const requestEmailLink = async (action: typeof linkGuestEmail | typeof signInWithEmail) => {
    setBusy(true);
    setNotice('');
    const ok = await action(email);
    setBusy(false);
    if (!ok) return;
    setNotice(action === linkGuestEmail
      ? 'Check your inbox and follow the confirmation link, if requested, to finish linking this guest profile.'
      : 'If an account exists for that email, check your inbox for a sign-in link. No new account will be created.');
  };

  return (
    <>
      <button className="profile-trigger" onClick={show} aria-label="Open player profile">
        <span className="profile-avatar">{profile?.avatar || <CircleUserRound size={17} />}</span>
        <span className="profile-trigger-label">{loading ? 'Loading…' : profile?.display_name || 'Player profile'}</span>
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="modal profile-modal">
            <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close profile"><X size={20} /></button>
            <div className="modal-icon"><CircleUserRound size={23} /></div>
            <div className="eyebrow">YOUR GATHER ID</div>
            <h2>Make yourself at home.</h2>
            <p>Your name and avatar help your friends recognize you when you play.</p>
            {!configured && <div className="profile-warning">Supabase is not connected yet. This profile will be saved in this browser only.</div>}

            <label className="field-label">
              DISPLAY NAME
              <input value={name} onChange={event => setName(event.target.value)} placeholder="What should we call you?" maxLength={24} />
            </label>
            <div className="field-label">
              CHOOSE AN AVATAR
              <div className="avatar-picker">
                {avatarChoices.map(choice => (
                  <button
                    type="button"
                    key={choice}
                    className={'avatar-choice ' + (avatar === choice ? 'chosen' : '')}
                    onClick={() => setAvatar(choice)}
                    aria-label={'Choose ' + choice}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary btn-large full-btn" onClick={save} disabled={busy || loading || !name.trim()}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Save profile
            </button>

            {configured && (
              <div className="account-upgrade">
                <div className="account-title"><Mail size={15} /> Keep your profile across devices</div>
                <p>Link your guest profile to an email, or sign in to an existing account.</p>
                <label className="field-label">
                  EMAIL ADDRESS
                  <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
                </label>
                {user?.is_anonymous && (
                  <button
                    className="btn btn-outline full-btn"
                    disabled={busy || loading || !email.includes('@')}
                    onClick={() => void requestEmailLink(linkGuestEmail)}
                  >
                    Link this guest profile
                  </button>
                )}
                {user && !user.is_anonymous && !loading && (
                  <p className="profile-warning">This account is linked. To keep this guest profile, link it before signing in on another account.</p>
                )}
                <button
                  className="btn btn-outline full-btn"
                  disabled={busy || loading || !email.includes('@')}
                  onClick={() => void requestEmailLink(signInWithEmail)}
                >
                  Sign in with existing email
                </button>
              </div>
            )}

            {(error || notice) && (
              <div className={error ? 'profile-error' : 'profile-success'}>
                {error || <><Check size={14} />{notice}</>}
              </div>
            )}
            <small className="modal-note">Never share passwords or private keys. Gather uses a secure sign-in session.</small>
          </div>
        </div>
      )}
    </>
  );
}
