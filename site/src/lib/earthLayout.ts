// ABOUTME: Atlas layout math for the Micropolis Earth globe view.
// ABOUTME: Maps cities into a grid texture that wraps onto a sphere via equirectangular projection.

const MAP_W = 120;
const MAP_H = 100;
const MAX_DIM = 8192;
export const COLS = 6;

// Extra rows above/below the city band for filler, keeping real cities away from poles.
const FILLER_PAD_ROWS = 1;

export interface AtlasLayout {
  cols: number;
  rows: number;
  totalRows: number;
  tilePx: number;
  cityW: number;
  cityH: number;
  width: number;
  height: number;
  padTop: number;
}

export function computeAtlasLayout(count: number): AtlasLayout {
  const cols = Math.min(count, COLS);
  const rows = Math.ceil(count / cols);
  const totalRows = rows + FILLER_PAD_ROWS * 2;

  let tilePx = Math.min(
    Math.floor(MAX_DIM / (cols * MAP_W)),
    Math.floor(MAX_DIM / (totalRows * MAP_H)),
  );
  tilePx = Math.max(2, Math.min(14, tilePx));

  const cityW = MAP_W * tilePx;
  const cityH = MAP_H * tilePx;

  return {
    cols, rows, totalRows, tilePx, cityW, cityH,
    width: cols * cityW,
    height: totalRows * cityH,
    padTop: FILLER_PAD_ROWS * cityH,
  };
}

export function getCityRect(index: number, layout: AtlasLayout): { x: number; y: number; w: number; h: number } {
  const col = index % layout.cols;
  const row = Math.floor(index / layout.cols);
  return {
    x: col * layout.cityW,
    y: layout.padTop + row * layout.cityH,
    w: layout.cityW,
    h: layout.cityH,
  };
}

// Returns all filler cell rects (padding rows above/below the real city band, plus
// any partially-filled cells in the last real row).
export function getFillerRects(layout: AtlasLayout, cityCount: number): { x: number; y: number; w: number; h: number }[] {
  const rects: { x: number; y: number; w: number; h: number }[] = [];

  // Top padding rows
  for (let r = 0; r < FILLER_PAD_ROWS; r++) {
    for (let c = 0; c < layout.cols; c++) {
      rects.push({ x: c * layout.cityW, y: r * layout.cityH, w: layout.cityW, h: layout.cityH });
    }
  }

  // Bottom padding rows
  const bottomStart = layout.padTop + layout.rows * layout.cityH;
  for (let r = 0; r < FILLER_PAD_ROWS; r++) {
    for (let c = 0; c < layout.cols; c++) {
      rects.push({ x: c * layout.cityW, y: bottomStart + r * layout.cityH, w: layout.cityW, h: layout.cityH });
    }
  }

  // Unfilled cells in the last row of the real city band
  const lastRowCities = cityCount % layout.cols;
  if (lastRowCities > 0) {
    const lastRow = Math.floor(cityCount / layout.cols);
    for (let c = lastRowCities; c < layout.cols; c++) {
      rects.push({
        x: c * layout.cityW,
        y: layout.padTop + lastRow * layout.cityH,
        w: layout.cityW, h: layout.cityH,
      });
    }
  }

  return rects;
}

export function uvToCityIndex(u: number, v: number, layout: AtlasLayout, count: number): number | null {
  const px = u * layout.width;
  const py = (1 - v) * layout.height;

  const cityBandTop = layout.padTop;
  const cityBandBottom = layout.padTop + layout.rows * layout.cityH;
  if (py < cityBandTop || py >= cityBandBottom) return null;

  const col = Math.floor(px / layout.cityW);
  const row = Math.floor((py - cityBandTop) / layout.cityH);
  if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return null;

  const index = row * layout.cols + col;
  if (index >= count) return null;
  return index;
}
