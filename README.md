# Gather — Game Night

A responsive React + TypeScript UI for a shared-screen party game experience: one host displays the game on a TV or laptop while everyone else joins on a phone.

## Current features

- Responsive dark UI and eight game cards
- Search and category filters
- Game details and create/join room previews
- Guest-first player profile editor with avatar choices
- Supabase client, persistent profiles, and game-history schema with Row Level Security

## Run locally

Requires Node.js 20+ and npm.

    npm install
    cp .env.example .env.local
    npm run dev

Without Supabase credentials, profile edits are saved only in the current browser's local storage. This fallback does not sync across devices.

## Connect Supabase

1. Create a project at https://supabase.com/dashboard.
2. In Project Settings -> API, copy the Project URL and publishable key (or legacy anon key) into .env.local as VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
3. In Authentication -> Sign In / Providers, enable Anonymous Sign-Ins for guest-first profiles. Configure email sign-in if you want account recovery across devices.
4. In SQL Editor, run the repository file supabase/schema.sql.
5. In Authentication -> URL Configuration, add https://carl-08.github.io/Uni-Game/ to allowed redirect URLs.
6. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to GitHub Actions repository secrets/variables and expose them to the build step, then redeploy. Only use the publishable/anon key in browser code. Never expose the service_role key.

## Security notes

- Row Level Security is enabled on both tables and scopes records to auth.uid().
- Anonymous identity persists in the same browser's Supabase auth session. Clearing browser storage may lose access to a guest identity.
- Email identity linking and recovery should be tested in the Supabase project before production use.
- Client-written scores are not authoritative; validate scores server-side before using leaderboards or prizes.

## Next milestones

1. Connect room codes and realtime room membership.
2. Build a shared host display and phone-controller view.
3. Implement a complete Family Trivia game loop.
4. Add trusted server-side score validation.
