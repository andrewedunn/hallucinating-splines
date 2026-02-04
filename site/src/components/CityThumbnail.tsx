// ABOUTME: Lazy-loading city map thumbnail rendered on a small canvas.
// ABOUTME: Fetches tile data client-side and draws a scaled-down map preview.

import { useRef, useEffect, useState } from 'react';
import { loadSpriteSheet, TILE_SIZE, tileIdFromRaw, spriteCoords } from '../lib/sprites';

interface Props {
  cityId: string;
  apiBase: string;
}

let cachedSpriteSheet: HTMLImageElement | null = null;

export default function CityThumbnail({ cityId, apiBase }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const [spriteSheet, mapResponse] = await Promise.all([
        cachedSpriteSheet
          ? Promise.resolve(cachedSpriteSheet)
          : loadSpriteSheet('/tiles.png').then(img => { cachedSpriteSheet = img; return img; }),
        fetch(`${apiBase}/v1/cities/${cityId}/map`),
      ]);

      if (cancelled || !canvasRef.current) return;
      if (!mapResponse.ok) return; // City has no game state (e.g. retired)

      const mapRes = await mapResponse.json();

      const canvas = canvasRef.current;
      const mapWidth = mapRes.width;
      const mapHeight = mapRes.height;
      const tiles = mapRes.tiles;

      // Draw full map to offscreen canvas, then scale down
      const offscreen = document.createElement('canvas');
      offscreen.width = mapWidth * TILE_SIZE;
      offscreen.height = mapHeight * TILE_SIZE;
      const offCtx = offscreen.getContext('2d')!;

      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          const raw = tiles[y * mapWidth + x];
          const tileId = tileIdFromRaw(raw);
          const { sx, sy } = spriteCoords(tileId);
          offCtx.drawImage(
            spriteSheet,
            sx, sy, TILE_SIZE, TILE_SIZE,
            x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE,
          );
        }
      }

      // Scale down to thumbnail
      canvas.width = canvas.clientWidth * 2; // 2x for retina
      canvas.height = canvas.clientHeight * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      setLoaded(true);
    }

    render();
    return () => { cancelled = true; };
  }, [cityId, apiBase]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '4px',
        background: loaded ? 'transparent' : 'var(--border)',
        display: 'block',
      }}
    />
  );
}
