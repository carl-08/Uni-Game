# Little Fables — standalone story-card game

This is a separate Vite + React + TypeScript app. It does not import Gather components or use Gather's database, migrations, Edge Functions, or room system. The 84 original local card images remain replaceable through `src/artCatalog.ts`.

## Run the local demo

From this folder:

```sh
npm install
npm run dev
```

Choose **Take your seat** for a local game with demo players. It works without Supabase and supports 2–8 players. In two-player test mode, one player votes, so the storyteller always scores 0 under the current rules; the other player gets 2 points. The game warns about this when it starts.

## Set up online rooms

Online play uses its own Supabase project. Do not use Gather's Supabase project or credentials.

1. Create a new Supabase project for this prototype.
2. In Supabase Authentication settings, enable **Anonymous sign-ins**.
3. Copy `.env.example` to `.env.local` inside this folder. Add the new project's URL and public anon key as `VITE_DIXIT_SUPABASE_URL` and `VITE_DIXIT_SUPABASE_ANON_KEY`.
4. In the new project's SQL Editor, run `supabase/schema.sql`.
5. Restart `npm run dev`. Choose **Online rooms**.

`dixit_settings.minimum_players` is the one setting for the start limit. It starts at 2 for testing. Change the row to 3 when the game is ready for a three-player minimum:

```sql
update public.dixit_settings set minimum_players = 3 where singleton = true;
```

### Host laptop

Choose **Create host display**. The host is display-only and never gets a player seat, hand, score, turn, or vote. Share the room code with players. The waiting list updates while players join. Start manually after the minimum number of players have joined; the list locks when the game starts. The host can end the room or reopen the host URL in the same signed-in browser to reconnect.

### Player phones

Open the same standalone app, choose **Online rooms**, enter a display name and room code, then join. The app remembers the anonymous Supabase session after a refresh. Each phone receives only that player's own hand from the room RPC. During voting, everyone receives the shuffled anonymous card list; owner IDs and votes are withheld until the server resolves the round.

Room screens poll the standalone RPC every 1.8 seconds, so the shared display and phones follow phase changes without exposing private room state through direct table reads. Only the RPC functions can read or change room tables.

## Build and preview

```sh
npm run build
npm run preview
```

The local demo remains available when the online environment values are absent. The GitHub Pages build also needs the standalone `VITE_DIXIT_SUPABASE_URL` and `VITE_DIXIT_SUPABASE_ANON_KEY` values set for its build step to enable online rooms; without them, the hosted page still runs the local demo.

## Rules and scoring

The scoring and local round resolution live in `src/game.ts`. Online scoring and room privacy are enforced by the dedicated SQL RPC functions in `supabase/schema.sql`. Both modes use six cards per player, a one-word clue, one submitted card per non-storyteller, anonymous shuffled voting, the requested all-or-none scoring rule, a 30-point end condition, and tied wins. The online start minimum is 2 players for testing and the maximum is 8.

### Card artwork

The original PNG sources are in `public/cards/`. The app uses the matching lazy-loaded WebP files in `public/cards-webp/`; run `npm run assets:webp` after replacing or adding source PNGs. The conversion keeps the source dimensions and the PNG originals are not changed. The current 84 source images are about 283–338 × 348–410 pixels, so none meets the requested 1024 × 1536 high-resolution size. See `ARTWORK_STATUS.md` for every card’s measured dimensions. They have not been stretched or described as high resolution.
