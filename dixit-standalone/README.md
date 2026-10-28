# Little Fables — standalone story-card game

This folder is a self-contained Vite + React + TypeScript prototype. It has its own entry point and styles and does not connect to Gather's site, room system, database, or admin dashboard.

## Run locally

From this folder:

```sh
npm install
npm run dev
```

The local demo works without any credentials. Choose 3–8 seats and the remaining players are demo players, so you can move through clue, card selection, voting, scoring, and game-over states. Enter a display name on the start screen.

To make a production build, run `npm run build`. To preview that build, run `npm run preview`.

## Open from Gather

The Gather game list includes Dreamweaver. Open its details and choose **Open 84-card prototype** to view this app as a separate page. On GitHub Pages it is published under `/Uni-Game/dixit-standalone/`; the main Gather site build creates that page alongside the main app.

## Online rooms

Online room networking is not wired up yet. The player view and shared laptop display can be opened in separate tabs with `?view=player` and `?view=display`; they sync through this browser's local storage and BroadcastChannel for a local presentation. This does not sync to a different device or provide online rooms. The `.env.example` reserves names for a dedicated Supabase project; it contains placeholders only. No Gather credentials are read by this app. Remote multiplayer needs a standalone server-side room protocol that returns only the requesting player's hand and withholds card owners and votes until reveal.

## Rules and artwork

The custom prototype scoring and round flow live in `src/game.ts`: six cards per player, one-word clues, one submitted card per non-storyteller, and the requested 30-point scoring rules. The full 84-card original illustration set lives in `public/cards/` with stable `card-001.png` through `card-084.png` filenames. `src/artCatalog.ts` maps each stable ID to its title and file. The labeled full-deck contact sheet is `public/card-contact-sheet.jpg` and can be opened at `/card-contact-sheet.jpg` while the dev server is running. Add future illustrations by extending the catalog. The standalone stylesheet uses local color tokens guided by Gather’s dark, lime, cream, and muted accent palette; it does not import the Gather stylesheet.
