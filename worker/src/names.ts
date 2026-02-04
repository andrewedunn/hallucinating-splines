// ABOUTME: Two-word name generator for mayors and cities.
// ABOUTME: Deterministic from a seed string (hashed to pick words).

const ADJECTIVES = [
  // Tech/futuristic
  'Neural', 'Quantum', 'Cyber', 'Neon', 'Prime', 'Nova', 'Flux', 'Vector',
  'Pixel', 'Binary', 'Sonic', 'Photon', 'Sigma', 'Apex', 'Omega', 'Helix',
  // Nature/elemental
  'Crystal', 'Sunset', 'Amber', 'Coral', 'Verdant', 'Azure', 'Crimson', 'Golden',
  'Misty', 'Frozen', 'Ember', 'Storm', 'Lunar', 'Solar', 'Tidal', 'Ashen',
  // Mood/character
  'Silent', 'Bold', 'Hollow', 'Noble', 'Stark', 'Fallen', 'Vivid', 'Serene',
  'Gilded', 'Rusted', 'Veiled', 'Sunken', 'Radiant', 'Dusky', 'Feral', 'Grand',
  // Scale/power
  'Iron', 'Titan', 'Vast', 'Twin', 'Ancient', 'Eternal', 'Obsidian', 'Marble',
  'Granite', 'Cobalt', 'Ivory', 'Scarlet', 'Jade', 'Onyx', 'Platinum', 'Bronze',
];

const NOUNS = [
  // Water/coastal
  'Harbor', 'Bay', 'Cove', 'Port', 'Wharf', 'Marina', 'Shoals', 'Reef',
  // Terrain/elevation
  'Valley', 'Ridge', 'Mesa', 'Summit', 'Bluff', 'Canyon', 'Plateau', 'Gorge',
  // Urban/settlement
  'City', 'Town', 'Spire', 'Citadel', 'Borough', 'Commons', 'Crossing', 'Junction',
  'Market', 'Quarter', 'District', 'Arcade', 'Plaza', 'Terrace', 'Promenade', 'Row',
  // Nature/landmark
  'Grove', 'Hollow', 'Glen', 'Meadow', 'Falls', 'Springs', 'Oasis', 'Thicket',
  'Creek', 'Lagoon', 'Marsh', 'Dell', 'Fen', 'Heath', 'Moor', 'Weald',
  // Industrial/modern
  'Forge', 'Foundry', 'Works', 'Mill', 'Yards', 'Docks', 'Depot', 'Hub',
  'Exchange', 'Terminal', 'Annex', 'Complex', 'Concourse', 'Pavilion', 'Atrium', 'Vault',
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
