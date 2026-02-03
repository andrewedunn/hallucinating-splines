// ABOUTME: Two-word name generator for mayors and cities.
// ABOUTME: Deterministic from a seed string (hashed to pick words).

const ADJECTIVES = [
  'Cosmic', 'Neon', 'Turbo', 'Dizzy', 'Fuzzy', 'Mighty', 'Snappy', 'Jolly',
  'Brave', 'Crafty', 'Dapper', 'Groovy', 'Happy', 'Lucky', 'Nimble', 'Plucky',
  'Quirky', 'Rustic', 'Savvy', 'Witty', 'Zesty', 'Bold', 'Calm', 'Eager',
  'Fierce', 'Gentle', 'Hasty', 'Keen', 'Lively', 'Merry', 'Noble', 'Proud',
  'Quick', 'Rapid', 'Sleek', 'Tough', 'Vivid', 'Warm', 'Young', 'Zippy',
  'Atomic', 'Blazing', 'Chill', 'Daring', 'Epic', 'Funky', 'Grand', 'Hyper',
  'Iron', 'Jade', 'Kinetic', 'Lunar', 'Mystic', 'Nova', 'Omega', 'Pixel',
  'Quantum', 'Retro', 'Solar', 'Titan', 'Ultra', 'Velvet', 'Warp', 'Xenon',
];

const NOUNS = [
  'Waffle', 'Penguin', 'Badger', 'Llama', 'Otter', 'Panda', 'Falcon', 'Tiger',
  'Dolphin', 'Raven', 'Cobra', 'Mantis', 'Bison', 'Crane', 'Gecko', 'Heron',
  'Jaguar', 'Koala', 'Lemur', 'Moose', 'Newt', 'Osprey', 'Puffin', 'Quail',
  'Robin', 'Stork', 'Toucan', 'Viper', 'Wolf', 'Yak', 'Zebra', 'Hawk',
  'Maple', 'Cedar', 'Aspen', 'Birch', 'Coral', 'Drift', 'Ember', 'Frost',
  'Gale', 'Haze', 'Isle', 'Jetty', 'Knoll', 'Marsh', 'Oasis', 'Peak',
  'Ridge', 'Storm', 'Tide', 'Vale', 'Wisp', 'Blaze', 'Crest', 'Dune',
  'Flint', 'Glen', 'Harbor', 'Inlet', 'Lagoon', 'Mesa', 'Nexus', 'Plume',
];

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function generateName(seed: string): string {
  const h = simpleHash(seed);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 8) % NOUNS.length];
  return `${adj} ${noun}`;
}

export function generateMayorName(seed: string): string {
  return `Mayor ${generateName(seed)}`;
}

export function generateCityName(seed: string): string {
  return generateName(seed);
}
