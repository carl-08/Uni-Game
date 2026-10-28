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

## Dreamweaver prototype

Open the Dreamweaver game card, then choose **Open 84-card prototype** to view the separate story-card prototype. GitHub Pages publishes it at `https://carl-08.github.io/Uni-Game/dixit-standalone/`. The normal Dreamweaver room option continues to use Gather's multiplayer room flow.

## Connect Supabase

1. Create a project at https://supabase.com/dashboard.
2. In Project Settings -> API, copy the Project URL and publishable key (or legacy anon key) into .env.local as VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
3. In Authentication -> Sign In / Providers, enable Anonymous Sign-Ins and the Email provider. Keep email confirmations enabled for email changes/sign-ins, and configure SMTP for reliable production delivery. Guests link an email from their current browser; returning players use **Sign in with existing email**, which requests an OTP without creating an account for unknown addresses.
4. In SQL Editor, run the repository file supabase/schema.sql.
5. In Authentication -> URL Configuration, set the deployed site URL and add `https://carl-08.github.io/Uni-Game/` and your local development URL (for example, `http://localhost:5173/`) to allowed redirect URLs.
6. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to GitHub Actions repository secrets/variables and expose them to the build step, then redeploy. Only use the publishable/anon key in browser code. Never expose the service_role key.

## Admin account management

1. Run `supabase/admin_schema.sql` after `supabase/schema.sql` and make sure at least one trusted administrator UUID is in `public.admin_users`.
2. Apply `supabase/migrations/20261022130000_account_management.sql` in the Supabase SQL Editor. This creates persistent bans and audit records, locks down their tables, adds Auth token and database ban enforcement, and adds a service-role-only account search/action RPC. Do not grant clients access to these tables or functions.
3. Install the Supabase CLI, authenticate with `npx supabase login`, and link this project with `npx supabase link --project-ref nbbtaigwasvulsssktpg`.
4. Apply the account-management migration with `npx supabase db push --linked`. Review the pending migration list before confirming. This assumes `schema.sql` and `admin_schema.sql` have already been applied to the linked project.
5. Deploy the trusted function with `npx supabase functions deploy admin-accounts --project-ref nbbtaigwasvulsssktpg`. The function requires JWT verification and uses Supabase's server-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never copy the service-role key into Vite variables, GitHub Pages secrets, or frontend code.
6. In Supabase Dashboard -> Authentication -> Hooks, enable the **Custom Access Token Hook** and select `public.reject_banned_user_token`. This blocks banned users from obtaining new/refreshed Auth tokens. Existing access JWTs may remain valid until expiry, but profile/game-history RLS policies reject banned users. Auth's ban duration also blocks sign-in and refresh; it does not guarantee immediate invalidation of already-issued JWTs.
7. Test admin list, ban, unban, deletion, and the Auth hook with non-production accounts before using them on production accounts.

Deleting an account deletes the Auth user through the Admin API, which cascades its profile and game-history rows under the existing foreign keys. The separate account audit retains actor ID, target ID, target email snapshot, action, timestamp, reason, and result status. Administrator accounts are protected from these player actions.

## Security notes

- Row Level Security is enabled on both tables and scopes records to auth.uid().
- Anonymous identity persists in the same browser's Supabase auth session. Clearing browser storage may lose access to a guest identity.
- A persistent ban is enforced against the banned Auth user ID, an associated email when present, token issuance, and protected profile/game-history database policies. Anonymous users have no stable identifier beyond their Auth user ID. Preserving anonymous sign-in means a banned guest could create a fresh anonymous ID; reliable attribution of that new ID is not possible without a stronger identity or disabling anonymous sign-in.
- Supabase Auth enforces unique email identities. Linking an email already used by another account is rejected; sign in to that account instead. Accounts are never merged by matching email text.
- Email confirmation, OTP redirects, and SMTP delivery should be tested in the Supabase project before production use.
- Client-written scores are not authoritative; validate scores server-side before using leaderboards or prizes.

## Next milestones

1. Connect room codes and realtime room membership.
2. Build a shared host display and phone-controller view.
3. Implement a complete Family Trivia game loop.
4. Add trusted server-side score validation.

## Rooms and Dreamweaver

Room creation, joining, invitation codes, QR downloads, lobby updates, host controls, and the first playable multiplayer game are implemented locally. Apply `supabase/migrations/20261022150000_rooms_story_game.sql` only after the base schema, admin schema, and account-management migration are installed. This migration adds private room/game tables, member-only lobby reads, and authenticated RPCs for room and game actions. It also adds `dreamweaver` to `game_controls`; admins can then enable or disable it from the existing dashboard.

The room migration uses the Supabase Realtime publication for public room/member changes. Game hands, clues before submission, card ownership during voting, and votes before reveal stay in a table that clients cannot read directly; the `room_state` RPC returns only the caller's hand and phase-appropriate public state. The database calculates scores and writes final results to `game_history`. Host transfers, game changes, room closure, capacity checks, duplicate joins, and game actions are checked in database functions.

Rooms accept new players only while waiting, expire after 12 hours, and close through a host action. Browser disconnects do not count as leaving. A waiting room's host remains host until transfer/closure or expiration. Completed matches remain in `game_history`; an unfinished match closed by its host is retained with the room state but is not recorded as a completed game. Other existing games can be selected for the room, but Dreamweaver is currently the only game with a complete multiplayer loop.

The original 48-card deck is stored as 48 individual SVG illustrations in `public/cards/`. `scripts/generate-story-cards.mjs` regenerates those authored vector scenes from the stable catalog in `src/data/storyCards.ts`.

To validate the local code, run `npm test`, `npm run build`, and `git diff --check`. The account-management and room/game migrations are applied to the configured Supabase project. Test live rooms with at least three separate signed-in browser sessions after the website deployment completes.
