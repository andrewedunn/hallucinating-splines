// ABOUTME: Interactive canvas component that renders city tile maps.
// ABOUTME: Supports pan (drag) and zoom (scroll). React island hydrated client-side.

import { useRef, useEffect, useState, useCallback } from 'react';
import { loadSpriteSheet, TILE_SIZE } from '../lib/sprites';
import { renderMap } from '../lib/tileRenderer';

declare global {
  interface Window {
    umami?: { track: (event: string) => void };
  }
}

interface Props {
  tiles: number[];
  width: number;
  height: number;
}

export default function MapViewer({ tiles, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [spriteSheet, setSpriteSheet] = useState<HTMLImageElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    loadSpriteSheet('/tiles.png').then(setSpriteSheet);
  }, []);

  useEffect(() => {
    if (!spriteSheet || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    const mapPixelW = width * TILE_SIZE;
    const mapPixelH = height * TILE_SIZE;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    // Fit map initially
    const scaleX = canvas.width / mapPixelW;
    const scaleY = canvas.height / mapPixelH;
    const fitScale = Math.min(scaleX, scaleY);

    if (zoom === 1) {
      ctx.scale(fitScale, fitScale);
    }

    renderMap(ctx, spriteSheet, tiles, width, height);
    ctx.restore();
  }, [spriteSheet, tiles, width, height, offset, zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(4, z * delta)));
  }, []);

  const zoomIn = useCallback(() => {
    window.umami?.track('map-zoom-in');
    setZoom(z => Math.min(4, z * 1.3));
  }, []);

  const zoomOut = useCallback(() => {
    window.umami?.track('map-zoom-out');
    setZoom(z => Math.max(0.5, z * 0.7));
  }, []);

  const resetView = useCallback(() => {
    window.umami?.track('map-reset');
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const btnStyle: React.CSSProperties = {
    width: 32, height: 32,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--surface, #1a1a2e)',
    border: '1px solid var(--border, #333)',
    borderRadius: 6,
    color: 'var(--text, #eee)',
    fontSize: 18, fontWeight: 700,
    cursor: 'pointer',
    lineHeight: 1,
    userSelect: 'none' as const,
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '500px', overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 4, flexDirection: 'column' }}>
        <button onClick={zoomIn} style={btnStyle} title="Zoom in">+</button>
        <button onClick={zoomOut} style={btnStyle} title="Zoom out">−</button>
        <button onClick={resetView} style={{ ...btnStyle, fontSize: 12 }} title="Reset view">⌂</button>
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 12, fontSize: 11, color: 'var(--text-muted, #888)', background: 'var(--surface, #1a1a2e)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border, #333)', opacity: 0.8 }}>
        Scroll to zoom · Drag to pan
      </div>
    </div>
  );
}
