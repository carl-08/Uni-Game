import { illustratedCards } from './artCatalog';

export type Phase = 'lobby' | 'clue' | 'submit' | 'vote' | 'results' | 'over';
export type Card = { id: string; colors: [string, string]; shape: string; title: string; motif: string; art?: string };
export type Player = { id: string; name: string; score: number; hand: Card[]; isBot?: boolean };
export type Entry = { card: Card; ownerId: string; isStoryteller: boolean };
export type RoundSummary = { playerId: string; playerName: string; correct: boolean; receivedVotes: number; base: number; bonus: number; total: number; note: string };
export type Game = { players: Player[]; deck: Card[]; discard: Card[]; round: number; storytellerIndex: number; phase: Phase; clue: string; storyCardId: string; submissions: Record<string, string[]>; entries: Entry[]; votes: Record<string, number>; summary: RoundSummary[]; lastStoryteller?: string };

const palettes: [string, string][] = [['#e6a98d', '#bd6e63'], ['#a5ddd0', '#378e91'], ['#c6a9eb', '#715eb4'], ['#e8d35e', '#d58b53'], ['#9db9ed', '#536aa4'], ['#f5a6bd', '#c65579'], ['#b9d990', '#629263'], ['#a9deee', '#3785a5'], ['#f3b690', '#b76769'], ['#c9c6ef', '#7275b4'], ['#e9df9b', '#b6924c'], ['#d3a7d8', '#995a9d']];
const placeholderNames = ['Moon garden', 'Paper boat', 'Cloud library', 'Quiet orbit', 'Golden hour', 'Tiny kingdom', 'Wildflower map', 'Sleeping giant', 'Blue doorway', 'Pocket ocean', 'Last train', 'Soft thunder', 'The long way', 'Velvet sky', 'Hidden stair', 'Warm rain', 'Faraway home', 'Silver thread', 'Slow parade', 'After the storm', 'Daydream', 'Small miracle', 'Winter sun', 'Secret song'];
const motifs = ['✦', '☾', '❋', '◉', '⌁', '♧', '❀', '◇', '☼', '≈', '✳', '◌'];

export function makeDeck(): Card[] {
  return Array.from({ length: 84 }, (_, i) => {
    const illustration = illustratedCards[i];
    return { id: illustration?.id ?? `placeholder-${i + 1}`, colors: palettes[i % palettes.length], shape: ['circle', 'arch', 'diamond', 'orb'][i % 4], title: illustration?.title ?? placeholderNames[i % placeholderNames.length], motif: motifs[i % motifs.length], art: illustration?.art };
  });
}

export function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function handSize(_playerCount: number): number { return 6; }

export function newGame(names: string[]): Game {
  if (names.length < 2 || names.length > 8) throw new Error('A game needs 2 to 8 players in the current test version.');
  if (names.some(name => !name.trim())) throw new Error('Every player needs a display name.');
  const deck = shuffle(makeDeck());
  const players = names.map((name, index) => ({ id: `p${index}`, name: name.trim().slice(0, 20), score: 0, hand: deck.splice(0, handSize(names.length)) }));
  return { players, deck, discard: [], round: 1, storytellerIndex: 0, phase: 'clue', clue: '', storyCardId: '', submissions: {}, entries: [], votes: {}, summary: [] };
}

export function storyteller(game: Game): Player { return game.players[game.storytellerIndex]; }

export function giveClue(game: Game, cardId: string, clue: string): Game {
  const word = clue;
  if (game.phase !== 'clue') throw new Error('It is not clue time.');
  if (!word || /\s/.test(word)) throw new Error('Use exactly one word with no spaces.');
  if (!storyteller(game).hand.some(card => card.id === cardId)) throw new Error('Choose a card from your hand.');
  return { ...game, phase: 'submit', clue: word, storyCardId: cardId, submissions: { [storyteller(game).id]: [cardId] } };
}

export function submitCards(game: Game, playerId: string, cardIds: string[]): Game {
  if (game.phase !== 'submit' || playerId === storyteller(game).id) throw new Error('Cards cannot be submitted now.');
  if (game.submissions[playerId]) throw new Error('You already submitted a card.');
  const player = game.players.find(candidate => candidate.id === playerId);
  if (!player || cardIds.length !== 1 || !player.hand.some(card => card.id === cardIds[0])) throw new Error('Choose exactly one card from your hand.');

  const submissions = { ...game.submissions, [playerId]: cardIds };
  if (!game.players.every(candidate => submissions[candidate.id])) return { ...game, submissions };

  const entries = shuffle(game.players.flatMap(candidate => submissions[candidate.id].map(id => ({
    card: candidate.hand.find(card => card.id === id)!,
    ownerId: candidate.id,
    isStoryteller: candidate.id === storyteller(game).id,
  }))));
  return { ...game, submissions, entries, phase: 'vote' };
}

export function castVote(game: Game, playerId: string, entryIndex: number): Game {
  if (game.phase !== 'vote' || playerId === storyteller(game).id) throw new Error('You cannot vote right now.');
  if (game.votes[playerId] !== undefined) throw new Error('You already voted.');
  const entry = game.entries[entryIndex];
  if (!entry || entry.ownerId === playerId) throw new Error('You cannot vote for your own card.');

  const votes = { ...game.votes, [playerId]: entryIndex };
  const voterCount = game.players.length - 1;
  if (Object.keys(votes).length === voterCount) return resolveRound({ ...game, votes });
  return { ...game, votes };
}

export function resolveRound(game: Game): Game {
  if (game.phase !== 'vote') throw new Error('This round is not ready to resolve.');
  const storyIndex = game.entries.findIndex(entry => entry.isStoryteller);
  const eligiblePlayers = game.players.filter(player => player.id !== storyteller(game).id);
  if (storyIndex < 0 || eligiblePlayers.some(player => game.votes[player.id] === undefined)) throw new Error('Wait until every player has voted.');

  const correctVotes = Object.values(game.votes).filter(vote => vote === storyIndex).length;
  const everyOrNoOneFound = correctVotes === 0 || correctVotes === eligiblePlayers.length;
  const votesPerCard = game.entries.map((_, index) => Object.values(game.votes).filter(vote => vote === index).length);
  const summary = game.players.map(player => {
    const isStoryteller = player.id === storyteller(game).id;
    const correct = !isStoryteller && !everyOrNoOneFound && game.votes[player.id] === storyIndex;
    const base = everyOrNoOneFound ? (isStoryteller ? 0 : 2) : (isStoryteller || correct ? 3 : 0);
    const receivedVotes = game.entries.reduce((total, entry, index) => total + (entry.ownerId === player.id ? votesPerCard[index] : 0), 0);
    const bonus = isStoryteller ? 0 : receivedVotes;
    const note = everyOrNoOneFound
      ? (isStoryteller ? 'Everyone guessed correctly, or nobody did.' : 'The storyteller scores 0; every other player gets 2.')
      : (isStoryteller ? 'Some, but not all, players found your card.' : correct ? 'You found the storyteller’s card.' : 'Your vote missed the storyteller’s card.');
    return { playerId: player.id, playerName: player.name, correct, receivedVotes, base, bonus, total: base + bonus, note };
  });

  const players = game.players.map(player => ({ ...player, score: player.score + (summary.find(item => item.playerId === player.id)?.total ?? 0) }));
  const discard = [...game.discard, ...game.entries.map(entry => entry.card)];
  const gameOver = players.some(player => player.score >= 30);
  return { ...game, players, discard, summary, phase: gameOver ? 'over' : 'results' };
}

export function nextRound(game: Game): Game {
  if (game.phase !== 'results') throw new Error('The round is still in progress.');
  const previousStoryteller = storyteller(game);
  const usedCardIds = new Set(game.entries.map(entry => entry.card.id));
  // resolveRound already placed these cards in the discard pile.
  const discard = [...game.discard];
  const drawPile = [...game.deck];
  const drawCard = (): Card | undefined => {
    if (drawPile.length === 0 && discard.length) drawPile.push(...shuffle(discard.splice(0)));
    return drawPile.pop();
  };

  const players = game.players.map(player => {
    const hand = player.hand.filter(card => !usedCardIds.has(card.id));
    while (hand.length < handSize(game.players.length)) {
      const card = drawCard();
      if (!card) break;
      hand.push(card);
    }
    return { ...player, hand };
  });

  return {
    ...game, players, deck: drawPile, discard, storytellerIndex: (game.storytellerIndex + 1) % game.players.length,
    round: game.round + 1, lastStoryteller: previousStoryteller.name, phase: 'clue', clue: '', storyCardId: '',
    submissions: {}, entries: [], votes: {}, summary: [],
  };
}
