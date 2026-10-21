# Gather — Game Night

A responsive React + TypeScript UI for a shared-screen party game experience. The idea: one host displays the game on a TV or laptop, while friends and family join on their phones.

## Included in this first UI pass

- Dark, playful visual system with lime accents and responsive layouts
- Eight game cards: Imposter, Family Trivia, Picture Clues, Push Your Luck, Charades, Draw & Guess, Word Spy, and Railway Rush
- Search and category filters
- Game detail modal
- Create-room and join-room preview flows
- Three-step “how it works” section

> **Current scope:** this is the front-end prototype. Create/join room buttons are intentionally preview-only; realtime multiplayer, room codes, authentication, and game state are not connected yet.

## Run locally

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Build

```bash
npm run build
npm run preview
```

## Suggested next milestones

1. Add a shared room model and short room codes.
2. Connect a realtime backend (for example, Supabase Realtime) with access policies.
3. Build the shared host screen and phone-controller views.
4. Implement one complete game loop (Family Trivia is a good first slice).
5. Add reconnection handling, host controls, and basic accessibility testing.

## Stack

- React
- TypeScript
- Vite
- Lucide icons
