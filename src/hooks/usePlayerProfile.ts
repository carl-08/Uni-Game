import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export type PlayerProfile = { user_id: string; display_name: string; avatar: string; created_at?: string; updated_at?: string };
const STORAGE_KEY = 'gather.player-profile.v1';
const avatars = ['🎮', '🦊', '🐸', '🐼', '🐙', '🦄', '🐯', '🐻'];
function localProfile(): PlayerProfile | null { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as PlayerProfile | null; } catch { return null; } }

function logSupabaseError(error: { code?: string; message: string }) {
  const message = error.message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted credential]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted credential]');
  console.error('[Gather] Supabase error', { code: error.code, message });
}

export function usePlayerProfile() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(() => localProfile());
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  const [configured] = useState(isSupabaseConfigured);

  const loadProfile = useCallback(async (activeUser: User) => {
    if (!supabase) return;
    const { data, error: readError } = await supabase.from('profiles').select('user_id,display_name,avatar,created_at,updated_at').eq('user_id', activeUser.id).maybeSingle();
    if (readError) { logSupabaseError(readError); setError('Could not load your profile. Check that supabase/schema.sql has been applied.'); return; }
    if (data) { setProfile(data as PlayerProfile); localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return; }
    const fallback = localProfile();
    const displayName = fallback?.display_name || `Player ${activeUser.id.slice(0, 4)}`;
    const avatar = fallback?.avatar || avatars[Math.floor(Math.random() * avatars.length)];
    const { data: created, error: createError } = await supabase.from('profiles').upsert(
      { user_id: activeUser.id, display_name: displayName, avatar },
      { onConflict: 'user_id', ignoreDuplicates: true },
    ).select('user_id,display_name,avatar,created_at,updated_at').maybeSingle();
    if (createError) { logSupabaseError(createError); setError('Could not create your profile. Check the Supabase schema and access policies.'); return; }
    if (created) { setProfile(created as PlayerProfile); localStorage.setItem(STORAGE_KEY, JSON.stringify(created)); return; }
    const { data: existing, error: existingError } = await supabase.from('profiles').select('user_id,display_name,avatar,created_at,updated_at').eq('user_id', activeUser.id).single();
    if (existingError) { logSupabaseError(existingError); setError('Could not load your profile. Check that supabase/schema.sql has been applied.'); return; }
    setProfile(existing as PlayerProfile); localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) { setLoading(false); return; }
    let alive = true;
    client.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) { logSupabaseError(sessionError); setError('Could not check your sign-in session. Please refresh and try again.'); setLoading(false); return; }
      let activeUser = data.session?.user ?? null;
      if (!activeUser) {
        const { data: anon, error: authError } = await client.auth.signInAnonymously();
        if (authError) { logSupabaseError(authError); setError('Enable Anonymous Sign-Ins in Supabase Auth to use guest profiles.'); setLoading(false); return; }
        activeUser = anon.user;
      }
      if (!alive) return;
      if (!activeUser) { setError('Could not establish a guest session. Please refresh and try again.'); setLoading(false); return; }
      setUser(activeUser); await loadProfile(activeUser); if (alive) setLoading(false);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      const activeUser = session?.user ?? null; setUser(activeUser);
      if (activeUser) void loadProfile(activeUser).finally(() => { if (alive) setLoading(false); }); else setProfile(null);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [loadProfile]);

  const saveProfile = useCallback(async (displayName: string, avatar: string) => {
    const cleanName = displayName.trim().slice(0, 24);
    if (!cleanName) { setError('Please enter a display name.'); return false; }
    setError('');
    if (!supabase) { const current = localProfile(); const next: PlayerProfile = { user_id: current?.user_id || crypto.randomUUID(), display_name: cleanName, avatar }; localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setProfile(next); return true; }
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      logSupabaseError(authError);
      setError(authError.name === 'AuthSessionMissingError'
        ? 'Your session expired. Refresh and try again.'
        : 'Could not verify your sign-in session. Please try again.');
      return false;
    }
    if (!authData.user) { setError('Could not verify your sign-in session. Please try again.'); return false; }
    const { data, error: saveError } = await supabase.from('profiles').upsert({ user_id: authData.user.id, display_name: cleanName, avatar }).select('user_id,display_name,avatar,created_at,updated_at').single();
    if (saveError) { logSupabaseError(saveError); setError('Could not save your profile. Please try again.'); return false; }
    setProfile(data as PlayerProfile); localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true;
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    if (!supabase) { setError('Connect Supabase first to enable account sign-in.'); return false; }
    const cleanEmail = email.trim(); if (!cleanEmail) { setError('Enter your email address.'); return false; }
    setError('');
    const { error: linkError } = await supabase.auth.updateUser({ email: cleanEmail });
    if (linkError) {
      logSupabaseError(linkError);
      const { error: otpError } = await supabase.auth.signInWithOtp({ email: cleanEmail, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
      if (otpError) { logSupabaseError(otpError); setError(otpError.message); return false; }
    }
    return true;
  }, []);
  return { user, profile, loading, error, configured, saveProfile, sendMagicLink };
}
