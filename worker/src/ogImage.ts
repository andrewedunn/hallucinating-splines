// ABOUTME: Generates 1200x630 Open Graph preview images for city sharing.
// ABOUTME: Composites the city map with a bitmap font text overlay — no external deps.

import { BIT_MASK } from '../../src/engine/tileFlags';
import { tileColor, deflate, encodePng } from './mapImage';

const OG_W = 1200;
const OG_H = 630;
const MAP_W = 120;
const MAP_H = 100;

// Background color (#1e2440)
const BG: [number, number, number] = [0x1e, 0x24, 0x40];

// 5x7 bitmap font — each char is 7 rows, each row is 5 bits (bit 4 = left)
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x0a, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x0a, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06],
  ',': [0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x08],
  ':': [0x00, 0x06, 0x06, 0x00, 0x06, 0x06, 0x00],
  '-': [0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
};

/** RGB pixel buffer with direct pixel access */
class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 3);
  }
  setPixel(x: number, y: number, r: number, g: number, b: number) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
  }
  getPixel(x: number, y: number): [number, number, number] {
    const i = (y * this.w + x) * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  fill(r: number, g: number, b: number) {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
    }
  }
}

/** Draw text using the bitmap font at a given pixel scale */
function drawText(
  buf: PixelBuffer, text: string, x: number, y: number,
  scale: number, r: number, g: number, b: number,
) {
  const charW = 5 * scale;
  const gap = scale; // 1px gap between chars, scaled
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch.toUpperCase()];
    if (!glyph) { cx += charW + gap; continue; }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              buf.setPixel(cx + col * scale + sx, y + row * scale + sy, r, g, b);
            }
          }
        }
      }
    }
    cx += charW + gap;
  }
}

/** Measure text width in pixels */
function textWidth(text: string, scale: number): number {
  const charW = 5 * scale;
  const gap = scale;
  return text.length * (charW + gap) - gap;
}

/** Draw a horizontal gradient overlay blending toward a target color */
function drawGradient(
  buf: PixelBuffer, startY: number, endY: number,
  tr: number, tg: number, tb: number, startAlpha: number, endAlpha: number,
) {
  for (let y = startY; y < endY && y < buf.h; y++) {
    const t = (y - startY) / (endY - startY);
    const alpha = startAlpha + (endAlpha - startAlpha) * t;
    for (let x = 0; x < buf.w; x++) {
      const [pr, pg, pb] = buf.getPixel(x, y);
      buf.setPixel(x, y,
        Math.round(pr * (1 - alpha) + tr * alpha),
        Math.round(pg * (1 - alpha) + tg * alpha),
        Math.round(pb * (1 - alpha) + tb * alpha),
      );
    }
  }
}

/** Draw the map tiles onto the buffer, scaled to fill width and centered vertically */
function drawMap(buf: PixelBuffer, tiles: number[], mapW: number, mapH: number) {
  const scale = Math.floor(buf.w / mapW); // 1200/120 = 10
  const imgH = mapH * scale; // 1000
  const offsetY = Math.floor((buf.h - imgH) / 2); // center vertically: (630-1000)/2 = -185

  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const tileId = tiles[ty * mapW + tx] & BIT_MASK;
      const [r, g, b] = tileColor(tileId);
      for (let sy = 0; sy < scale; sy++) {
        const py = offsetY + ty * scale + sy;
        if (py < 0 || py >= buf.h) continue;
        for (let sx = 0; sx < scale; sx++) {
          buf.setPixel(tx * scale + sx, py, r, g, b);
        }
      }
    }
  }
}

/** Convert PixelBuffer to PNG row format (filter byte + RGB per row) */
function toRawPng(buf: PixelBuffer): Uint8Array {
  const raw = new Uint8Array(buf.h * (1 + buf.w * 3));
  let offset = 0;
  for (let y = 0; y < buf.h; y++) {
    raw[offset++] = 0; // filter: None
    const rowStart = y * buf.w * 3;
    raw.set(buf.data.subarray(rowStart, rowStart + buf.w * 3), offset);
    offset += buf.w * 3;
  }
  return raw;
}

export interface OgImageData {
  tiles: number[];
  mapWidth: number;
  mapHeight: number;
  cityName: string;
  mayorName: string;
  population: number;
  year: number;
  score: number;
}

export async function generateOgImage(data: OgImageData): Promise<Uint8Array> {
  const buf = new PixelBuffer(OG_W, OG_H);
  buf.fill(BG[0], BG[1], BG[2]);

  // Draw map background
  drawMap(buf, data.tiles, data.mapWidth, data.mapHeight);

  // Dark gradient overlay on bottom 55%
  const gradStart = Math.floor(OG_H * 0.45);
  drawGradient(buf, gradStart, OG_H, BG[0], BG[1], BG[2], 0.0, 0.92);

  // City name — large (scale 4 = 20x28 per char)
  const nameScale = 4;
  const nameY = OG_H - 120;
  drawText(buf, data.cityName, 40, nameY, nameScale, 0xf0, 0xe8, 0xd8);

  // Mayor name — medium (scale 2)
  const mayorScale = 2;
  drawText(buf, data.mayorName, 42, nameY + 7 * nameScale + 10, mayorScale, 0x80, 0x90, 0xb0);

  // Stats line — medium (scale 2)
  const statsText = `POP ${data.population.toLocaleString()}  YR ${data.year}  SCORE ${data.score}`;
  const statsY = nameY + 7 * nameScale + 10 + 7 * mayorScale + 8;
  drawText(buf, statsText, 42, statsY, mayorScale, 0x58, 0xb0, 0xa8);

  // Branding — small (scale 2), bottom right
  const brand = 'HALLUCINATINGSPLINES.COM';
  const brandScale = 2;
  const brandW = textWidth(brand, brandScale);
  drawText(buf, brand, OG_W - brandW - 40, OG_H - 7 * brandScale - 20, brandScale, 0x50, 0x60, 0x90);

  const raw = toRawPng(buf);
  const compressed = await deflate(raw);
  return encodePng(OG_W, OG_H, compressed);
}

/** Fallback OG image when map data is unavailable */
export async function generateOgImageFallback(
  cityName: string, mayorName: string, population: number, year: number, score: number,
): Promise<Uint8Array> {
  const buf = new PixelBuffer(OG_W, OG_H);
  buf.fill(BG[0], BG[1], BG[2]);

  // City name centered
  const nameScale = 5;
  const nameW = textWidth(cityName, nameScale);
  const nameX = Math.floor((OG_W - nameW) / 2);
  drawText(buf, cityName, nameX, 200, nameScale, 0xf0, 0xe8, 0xd8);

  // Mayor
  const mayorScale = 3;
  const mayorW = textWidth(mayorName, mayorScale);
  drawText(buf, mayorName, Math.floor((OG_W - mayorW) / 2), 260, mayorScale, 0x80, 0x90, 0xb0);

  // Stats
  const statsText = `POP ${population.toLocaleString()}  YR ${year}  SCORE ${score}`;
  const statsScale = 2;
  const statsW = textWidth(statsText, statsScale);
  drawText(buf, statsText, Math.floor((OG_W - statsW) / 2), 320, statsScale, 0x58, 0xb0, 0xa8);

  // Branding
  const brand = 'HALLUCINATINGSPLINES.COM';
  const brandScale = 2;
  const brandW = textWidth(brand, brandScale);
  drawText(buf, brand, Math.floor((OG_W - brandW) / 2), OG_H - 7 * brandScale - 40, brandScale, 0x50, 0x60, 0x90);

  const raw = toRawPng(buf);
  const compressed = await deflate(raw);
  return encodePng(OG_W, OG_H, compressed);
}
