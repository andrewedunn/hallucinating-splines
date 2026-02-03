// ABOUTME: Loads the Micropolis sprite sheet and maps tile IDs to sprite coordinates.
// ABOUTME: Sprite sheet is 512x512px with 32x32 grid of 16x16 tiles.

export const TILE_SIZE = 16;
export const TILES_PER_ROW = 32;
export const BIT_MASK = 0x3FF;

export async function loadSpriteSheet(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function tileIdFromRaw(rawValue: number): number {
  return rawValue & BIT_MASK;
}

export function spriteCoords(tileId: number): { sx: number; sy: number } {
  const col = tileId % TILES_PER_ROW;
  const row = Math.floor(tileId / TILES_PER_ROW);
  return { sx: col * TILE_SIZE, sy: row * TILE_SIZE };
}
