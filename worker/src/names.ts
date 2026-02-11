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
  // Loading screen participles
  'Reticulated', 'Tessellated', 'Coalesced', 'Perturbed', 'Sublimated', 'Calibrated', 'Synthesized', 'Obfuscated',
  'Gesticulated', 'Iterated', 'Partitioned', 'Stratified', 'Compounded', 'Decomposed',
  // City-builder gameplay verbs
  'Zoned', 'Bulldozed', 'Terraformed', 'Plopped', 'Sprawled', 'Annexed', 'Gridded', 'Funded',
  'Rezoned', 'Budgeted', 'Surveyed', 'Plotted',
  // City-builder tech/buildings (as adjectives)
  'Orbital', 'Fusion', 'Hydro', 'Elevated', 'Microwave', 'Arcological',
  // Speed settings & mascots
  'Cheetah', 'Llama', 'Turtle',
  // The Sims
  'Plumbob', 'Woohoo',
  // Sim-game culture
  'Procedural', 'Isometric', 'Seeded', 'Tiled', 'Simulated', 'Pixelated', 'Bungeling', 'Maxis',
  // City-builder vibes
  'Commuter', 'Suburban', 'Metro', 'Transit', 'Civic', 'Municipal', 'Polluted', 'Renewable',
  'Sprawling', 'Layered',
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
  // Micropolis buildings/structures
  'Arcology', 'Reactor', 'Turbine', 'Monorail', 'Aqueduct', 'Seaport', 'Runway', 'Precinct',
  'Overpass', 'Underpass', 'Freeway', 'Causeway', 'Pipeline', 'Substation', 'Incinerator',
  // SC2000 arcology names
  'Plymouth', 'Darco',
  // Micropolis zones/planning
  'Zone', 'Grid', 'Plat', 'Tract', 'Parcel', 'Sprawl', 'Corridor', 'Setback', 'Easement',
  // Power/utilities
  'Generator', 'Conduit', 'Pylon', 'Transformer', 'Cistern', 'Reservoir', 'Outfall',
  // Micropolis disasters
  'Tornado', 'Quake', 'Meltdown', 'Inferno',
  // Maxis culture
  'Spline', 'Matrix',
  // Other Maxis Sim games
  'Colony', 'Anthill', 'Biome', 'Terrarium', 'Safari', 'Canopy', 'Atoll',
  // Civilization
  'Settler', 'Wonder', 'Granary', 'Barracks', 'Colossus', 'Oracle', 'Pantheon', 'Ziggurat',
  // Cities: Skylines
  'Chirper', 'Roundabout', 'Interchange', 'Bypass', 'Offramp',
  // City-builder culture
  'Skyline', 'Footprint', 'Brownfield', 'Greenfield', 'Density',
  // Loading screens (as place-nouns)
  'Exemplar', 'Automaton',
  // Will Wright's legacy
  'Wright',
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function shortCode(id: string): string {
  // Extract first 6 hex chars after the prefix (city_ or key_)
  const hex = id.replace(/^(city_|key_)/, '');
  return hex.slice(0, 6);
}

export function generateCitySlug(cityId: string, cityName?: string): string {
  const name = cityName || generateCityName(cityId);
  return `${slugify(name)}-${shortCode(cityId)}`;
}

export function generateMayorSlug(keyId: string, mayorName?: string): string {
  const raw = mayorName || generateMayorName(keyId);
  const name = raw.replace(/^Mayor\s+/i, '');
  return `${slugify(name)}-${shortCode(keyId)}`;
}

export function extractShortCode(slug: string): string {
  const parts = slug.split('-');
  return parts[parts.length - 1];
}
