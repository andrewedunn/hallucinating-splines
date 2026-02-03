// ABOUTME: Renders a grid of tiles onto an HTML canvas using the Micropolis sprite sheet.
// ABOUTME: Supports rendering full maps (120x100) or partial regions.

import { TILE_SIZE, tileIdFromRaw, spriteCoords } from './sprites';

export function renderMap(
  ctx: CanvasRenderingContext2D,
  spriteSheet: HTMLImageElement,
  tiles: number[],
  mapWidth: number,
  mapHeight: number,
): void {
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const raw = tiles[y * mapWidth + x];
      const tileId = tileIdFromRaw(raw);
      const { sx, sy } = spriteCoords(tileId);
      ctx.drawImage(
        spriteSheet,
        sx, sy, TILE_SIZE, TILE_SIZE,
        x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE,
      );
    }
  }
}
