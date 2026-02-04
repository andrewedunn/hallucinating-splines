// ABOUTME: Interactive canvas component that renders city tile maps.
// ABOUTME: Supports pan (drag/touch) and zoom (scroll/pinch). React island hydrated client-side.

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

function getTouchDistance(touches: React.TouchList | TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touches: React.TouchList | TouchList): { x: number; y: number } {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export default function MapViewer({ tiles, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [spriteSheet, setSpriteSheet] = useState<HTMLImageElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const fitScaleRef = useRef(1);

  // Touch gesture refs (refs to avoid stale closures in event listeners)
  const touchStateRef = useRef({
    lastDist: 0,
    lastCenter: { x: 0, y: 0 },
    isPinching: false,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
  });
  const offsetRef = useRef(offset);
  const zoomRef = useRef(zoom);

  // Keep refs in sync with state
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    loadSpriteSheet('/tiles.png').then(setSpriteSheet);
  }, []);

  // Compute fitScale and set initial zoom/offset to center the map
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const mapPixelW = width * TILE_SIZE;
    const mapPixelH = height * TILE_SIZE;
    const fitScale = Math.min(canvas.width / mapPixelW, canvas.height / mapPixelH);
    fitScaleRef.current = fitScale;
    if (zoom === 0) {
      setZoom(fitScale);
      setOffset({
        x: (canvas.width - mapPixelW * fitScale) / 2,
        y: (canvas.height - mapPixelH * fitScale) / 2,
      });
    }
  }, [spriteSheet, width, height]);

  useEffect(() => {
    if (!spriteSheet || !canvasRef.current || zoom === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    renderMap(ctx, spriteSheet, tiles, width, height);
    ctx.restore();
  }, [spriteSheet, tiles, width, height, offset, zoom]);

  // Touch event handlers (attached via addEventListener for passive: false)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const ts = touchStateRef.current;
        ts.isPinching = true;
        ts.isDragging = false;
        ts.lastDist = getTouchDistance(e.touches);
        ts.lastCenter = getTouchCenter(e.touches);
      } else if (e.touches.length === 1) {
        const ts = touchStateRef.current;
        ts.isDragging = true;
        ts.isPinching = false;
        ts.dragStart = {
          x: e.touches[0].clientX - offsetRef.current.x,
          y: e.touches[0].clientY - offsetRef.current.y,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const ts = touchStateRef.current;
      if (ts.isPinching && e.touches.length === 2) {
        e.preventDefault();
        const newDist = getTouchDistance(e.touches);
        const newCenter = getTouchCenter(e.touches);
        const fit = fitScaleRef.current;
        const newZoom = Math.max(fit * 0.5, Math.min(fit * 6, zoomRef.current * (newDist / ts.lastDist)));

        // Pan with pinch center movement
        const dx = newCenter.x - ts.lastCenter.x;
        const dy = newCenter.y - ts.lastCenter.y;

        // Adjust offset to keep pinch center stationary during scale change
        const ratio = newZoom / zoomRef.current;
        const cx = ts.lastCenter.x;
        const cy = ts.lastCenter.y;
        const newOffX = cx - (cx - offsetRef.current.x) * ratio + dx;
        const newOffY = cy - (cy - offsetRef.current.y) * ratio + dy;

        setZoom(newZoom);
        setOffset({ x: newOffX, y: newOffY });

        ts.lastDist = newDist;
        ts.lastCenter = newCenter;
      } else if (ts.isDragging && e.touches.length === 1) {
        e.preventDefault();
        setOffset({
          x: e.touches[0].clientX - ts.dragStart.x,
          y: e.touches[0].clientY - ts.dragStart.y,
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const ts = touchStateRef.current;
      if (e.touches.length < 2) {
        ts.isPinching = false;
      }
      if (e.touches.length === 0) {
        ts.isDragging = false;
      }
      // If went from 2 fingers to 1, start single-finger drag from remaining touch
      if (e.touches.length === 1) {
        ts.isDragging = true;
        ts.dragStart = {
          x: e.touches[0].clientX - offsetRef.current.x,
          y: e.touches[0].clientY - offsetRef.current.y,
        };
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const zoomMinMax = useCallback((z: number) => {
    const fit = fitScaleRef.current;
    return Math.max(fit * 0.5, Math.min(fit * 6, z));
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    setZoom(prevZoom => {
      const newZoom = zoomMinMax(prevZoom * delta);
      const ratio = newZoom / prevZoom;
      setOffset(o => ({
        x: cx - (cx - o.x) * ratio,
        y: cy - (cy - o.y) * ratio,
      }));
      return newZoom;
    });
  }, [zoomMinMax]);

  const zoomFromCenter = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.clientWidth / 2;
    const cy = canvas.clientHeight / 2;
    setZoom(prevZoom => {
      const newZoom = zoomMinMax(prevZoom * factor);
      const ratio = newZoom / prevZoom;
      setOffset(o => ({
        x: cx - (cx - o.x) * ratio,
        y: cy - (cy - o.y) * ratio,
      }));
      return newZoom;
    });
  }, [zoomMinMax]);

  const zoomIn = useCallback(() => {
    window.umami?.track('map-zoom-in');
    zoomFromCenter(1.3);
  }, [zoomFromCenter]);

  const zoomOut = useCallback(() => {
    window.umami?.track('map-zoom-out');
    zoomFromCenter(0.7);
  }, [zoomFromCenter]);

  const resetView = useCallback(() => {
    window.umami?.track('map-reset');
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = fitScaleRef.current;
    const mapPixelW = width * TILE_SIZE;
    const mapPixelH = height * TILE_SIZE;
    setZoom(fit);
    setOffset({
      x: (canvas.clientWidth - mapPixelW * fit) / 2,
      y: (canvas.clientHeight - mapPixelH * fit) / 2,
    });
  }, [width, height]);

  const btnStyle: React.CSSProperties = {
    width: 40, height: 40,
    minWidth: 40, minHeight: 40,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--surface, #1a1a2e)',
    border: '1px solid var(--border, #333)',
    borderRadius: 8,
    color: 'var(--text, #eee)',
    fontSize: 20, fontWeight: 700,
    cursor: 'pointer',
    lineHeight: 1,
    userSelect: 'none' as const,
    touchAction: 'manipulation' as const,
  };

  const hintText = isTouchDevice ? 'Pinch to zoom \u00b7 Drag to pan' : 'Scroll to zoom \u00b7 Drag to pan';

  return (
    <div ref={containerRef} style={{ width: '100%', height: '500px', overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', position: 'relative', touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 6, flexDirection: 'column' }}>
        <button onClick={zoomIn} style={btnStyle} title="Zoom in">+</button>
        <button onClick={zoomOut} style={btnStyle} title="Zoom out">{'\u2212'}</button>
        <button onClick={resetView} style={{ ...btnStyle, fontSize: 14 }} title="Reset view">{'\u2302'}</button>
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 12, fontSize: 11, color: 'var(--text-muted, #888)', background: 'var(--surface, #1a1a2e)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border, #333)', opacity: 0.8 }}>
        {hintText}
      </div>
    </div>
  );
}
