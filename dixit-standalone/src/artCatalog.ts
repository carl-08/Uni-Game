export type IllustratedCard = { id: string; title: string; art: string };

const titles = [
  'The pear lighthouse', 'A stairway in a teacup', 'A garden beneath the rain', 'A moon carried by birds',
  'The lantern whale', 'A door in an old tree', 'A flower constellation', 'Mountains in the shadow',
  'The river climbs the sky', 'The fox borrows an hour', 'Music between islands', 'A boat among blue flowers',
  'A caravan beneath a jellyfish', 'A door above the clouds', 'A pocket storm', 'A train in the sunflower',
  'Bottled worlds', 'A gateway in the ice', 'Fish across the night sky', 'A crown on the hill',
  'The inverted forest', 'The moth’s beacon', 'The empty pool', 'Stones through pink fog',
  'A lantern in a snow globe', 'Piano steps across water', 'The cloud turtle', 'A door in the grass',
  'The forest in flight', 'A suitcase waterfall', 'The moon on a ribbon', 'A greenhouse of clouds',
  'A well of stars', 'Tea between cliffs', 'The wave horse', 'Boats in the watch',
  'The drifting library', 'The peach tree stairway', 'A sail made of night', 'The rabbit hill',
  'The key in the sky', 'Dandelion planets', 'Summer in a mirror', 'The tortoise village',
  'A stairway into green', 'The teapot of stars', 'A kite in blossom', 'The tree’s hidden sea',
  'The shell staircase', 'The paper fleet', 'Sunrise through stone', 'The glass elephant',
  'The tree station', 'The lighthouse moon', 'A stairway of blue cloth', 'The garden of seasons',
  'The cat constellation', 'A desert in a bowl', 'The door below the waves', 'The sleeping hand',
  'The heron’s reflection', 'The cloud elevator', 'A boat beneath the ice', 'The cypress stair',
  'An ocean in the wardrobe', 'A hand of fireflies', 'A lighthouse in a raindrop', 'Balloons over the bridge',
  'Autumn in the mountain', 'The mushroom skyboat', 'The seaside cat', 'The mountain fountain',
  'The silver river', 'Winter in a bell jar', 'Lantern fruit', 'The feather bridge',
  'The piano lilies', 'The observatory tortoise', 'A balloon below the sea', 'The pink mountain door',
  'The pond runner', 'Islands in teacups', 'The crystal passage', 'The empty swing',
];

// IDs and file paths are stable. Add new illustrations to this list and public/cards.
export const illustratedCards: IllustratedCard[] = titles.map((title, index) => {
  const id = `card-${String(index + 1).padStart(3, '0')}`;
  return { id, title, art: `/cards-webp/${id}.webp` };
});
