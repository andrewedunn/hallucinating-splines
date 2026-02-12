// ABOUTME: Generates a colored-pixel PNG from city tile data.
// ABOUTME: Maps tile types to colors and encodes a minimal PNG using deflate.

import { BIT_MASK, POWERBIT } from '../../src/engine/tileFlags';
import {
  DIRT, RIVER, WATER_HIGH, TREEBASE, WOODS_HIGH,
  RUBBLE, LASTRUBBLE, ROADBASE, LASTROAD, POWERBASE, LASTPOWER,
  RAILBASE, LASTRAIL,
} from '../../src/engine/tileValues';

// Tile type color mapping (RGB)
const COLOR_DIRT: [number, number, number] = [0x8B, 0x45, 0x13];
const COLOR_WATER: [number, number, number] = [0x00, 0x69, 0x94];
const COLOR_TREE: [number, number, number] = [0x22, 0x8B, 0x22];
const COLOR_ROAD: [number, number, number] = [0x40, 0x40, 0x40];
const COLOR_RAIL: [number, number, number] = [0x78, 0x5E, 0x3A];
const COLOR_POWER_LINE: [number, number, number] = [0xFF, 0xD7, 0x00];
const COLOR_RUBBLE: [number, number, number] = [0x9E, 0x9E, 0x9E];
const COLOR_RESIDENTIAL: [number, number, number] = [0x4C, 0xAF, 0x50];
const COLOR_COMMERCIAL: [number, number, number] = [0x21, 0x96, 0xF3];
const COLOR_INDUSTRIAL: [number, number, number] = [0xFF, 0xC1, 0x07];
const COLOR_COAL: [number, number, number] = [0x61, 0x61, 0x61];
const COLOR_NUCLEAR: [number, number, number] = [0x9C, 0x27, 0xB0];
const COLOR_POLICE: [number, number, number] = [0x3F, 0x51, 0xB5];
const COLOR_FIRE: [number, number, number] = [0xF4, 0x43, 0x36];
const COLOR_PARK: [number, number, number] = [0x66, 0xBB, 0x6A];
const COLOR_SEAPORT: [number, number, number] = [0x00, 0x96, 0x88];
const COLOR_AIRPORT: [number, number, number] = [0x78, 0x90, 0x9C];
const COLOR_STADIUM: [number, number, number] = [0xFF, 0x57, 0x22];

// Tile value ranges from tileValues.js (approximate groupings)
// Residential: 244-422, Commercial: 423-611, Industrial: 612-692
// Coal power: 745-760, Nuclear: 811-826, Fire station: 761-769, Police: 770-778
// Seaport: 693-708, Airport: 709-744, Stadium: 779-810
const RESIDENTIAL_LOW = 244;
const RESIDENTIAL_HIGH = 422;
const COMMERCIAL_LOW = 423;
const COMMERCIAL_HIGH = 611;
const INDUSTRIAL_LOW = 612;
const INDUSTRIAL_HIGH = 692;
const SEAPORT_LOW = 693;
const SEAPORT_HIGH = 708;
const AIRPORT_LOW = 709;
const AIRPORT_HIGH = 744;
const COAL_LOW = 745;
const COAL_HIGH = 760;
const FIRE_LOW = 761;
const FIRE_HIGH = 769;
const POLICE_LOW = 770;
const POLICE_HIGH = 778;
const STADIUM_LOW = 779;
const STADIUM_HIGH = 810;
const NUCLEAR_LOW = 811;
const NUCLEAR_HIGH = 826;
const PARK_LOW = 37; // FOUNTAIN_BASE from tileValues
const PARK_HIGH = 44;

function tileColor(tileId: number): [number, number, number] {
  if (tileId === DIRT) return COLOR_DIRT;
  if (tileId >= RIVER && tileId <= WATER_HIGH) return COLOR_WATER;
  if (tileId >= TREEBASE && tileId <= WOODS_HIGH) return COLOR_TREE;
  if (tileId >= RUBBLE && tileId <= LASTRUBBLE) return COLOR_RUBBLE;
  if (tileId >= ROADBASE && tileId <= LASTROAD) return COLOR_ROAD;
  if (tileId >= RAILBASE && tileId <= LASTRAIL) return COLOR_RAIL;
  if (tileId >= POWERBASE && tileId <= LASTPOWER) return COLOR_POWER_LINE;
  if (tileId >= PARK_LOW && tileId <= PARK_HIGH) return COLOR_PARK;
  if (tileId >= RESIDENTIAL_LOW && tileId <= RESIDENTIAL_HIGH) return COLOR_RESIDENTIAL;
  if (tileId >= COMMERCIAL_LOW && tileId <= COMMERCIAL_HIGH) return COLOR_COMMERCIAL;
  if (tileId >= INDUSTRIAL_LOW && tileId <= INDUSTRIAL_HIGH) return COLOR_INDUSTRIAL;
  if (tileId >= SEAPORT_LOW && tileId <= SEAPORT_HIGH) return COLOR_SEAPORT;
  if (tileId >= AIRPORT_LOW && tileId <= AIRPORT_HIGH) return COLOR_AIRPORT;
  if (tileId >= COAL_LOW && tileId <= COAL_HIGH) return COLOR_COAL;
  if (tileId >= FIRE_LOW && tileId <= FIRE_HIGH) return COLOR_FIRE;
  if (tileId >= POLICE_LOW && tileId <= POLICE_HIGH) return COLOR_POLICE;
  if (tileId >= STADIUM_LOW && tileId <= STADIUM_HIGH) return COLOR_STADIUM;
  if (tileId >= NUCLEAR_LOW && tileId <= NUCLEAR_HIGH) return COLOR_NUCLEAR;
  // Powered road (HROADPOWER=64, VROADPOWER=65)
  if (tileId === 64 || tileId === 65) return COLOR_ROAD;
  return COLOR_DIRT;
}

/**
 * Generate a PNG image from tile data.
 * Each tile = 1 pixel, scaled up by `scale` factor.
 */
export { tileColor, deflate, encodePng };

export async function generateMapImage(
  tiles: number[],
  width: number,
  height: number,
  scale: number,
): Promise<Uint8Array> {
  const imgW = width * scale;
  const imgH = height * scale;

  // Build raw pixel data (filter byte 0 + RGB for each row)
  const rawSize = imgH * (1 + imgW * 3);
  const raw = new Uint8Array(rawSize);
  let offset = 0;

  for (let ty = 0; ty < height; ty++) {
    for (let sy = 0; sy < scale; sy++) {
      raw[offset++] = 0; // filter byte: None
      for (let tx = 0; tx < width; tx++) {
        const tileId = tiles[ty * width + tx] & BIT_MASK;
        const [r, g, b] = tileColor(tileId);
        for (let sx = 0; sx < scale; sx++) {
          raw[offset++] = r;
          raw[offset++] = g;
          raw[offset++] = b;
        }
      }
    }
  }

  // Compress with deflate using Web Compression API
  const compressed = await deflate(raw);

  return encodePng(imgW, imgH, compressed);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }

  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const chunk of chunks) {
    result.set(chunk, off);
    off += chunk.length;
  }
  return result;
}

function encodePng(width: number, height: number, compressedData: Uint8Array): Uint8Array {
  const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const totalSize = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalSize);
  let off = 0;
  png.set(PNG_SIGNATURE, off); off += PNG_SIGNATURE.length;
  png.set(ihdrChunk, off); off += ihdrChunk.length;
  png.set(idatChunk, off); off += idatChunk.length;
  png.set(iendChunk, off);

  return png;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4); // length + type + data + crc
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return chunk;
}

// CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
