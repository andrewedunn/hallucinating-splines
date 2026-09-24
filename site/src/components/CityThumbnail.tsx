// ABOUTME: Renders the current city map and, on the homepage, loops through recorded map changes.
// ABOUTME: Pauses off screen and for reduced motion, and labels recorded views separately from current data.
import { useEffect, useRef, useState } from 'react';
import { loadSpriteSheet, TILE_SIZE } from '../lib/sprites';
import { renderMap } from '../lib/tileRenderer';

interface Props {
  cityId: string;
  apiBase: string;
  animate?: boolean;
  active?: boolean;
}
interface MapData { tiles: number[]; width: number; height: number; }
interface PreviewFrame { image: HTMLCanvasElement; label: string; }

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 400;
let spritePromise: Promise<HTMLImageElement> | null = null;

function spriteSheet() {
  if (!spritePromise) spritePromise = loadSpriteSheet('/tiles.png').catch(error => {
    spritePromise = null;
    throw error;
  });
  return spritePromise;
}

function renderPreview(sheet: HTMLImageElement, map: MapData): HTMLCanvasElement {
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) ||
      map.width <= 0 || map.height <= 0 || !Array.isArray(map.tiles) ||
      map.tiles.length !== map.width * map.height) throw new Error('Invalid city map');
  const full = document.createElement('canvas');
  full.width = map.width * TILE_SIZE;
  full.height = map.height * TILE_SIZE;
  renderMap(full.getContext('2d')!, sheet, map.tiles, map.width, map.height);

  const preview = document.createElement('canvas');
  preview.width = PREVIEW_WIDTH;
  preview.height = PREVIEW_HEIGHT;
  const ctx = preview.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(full, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  return preview;
}

function showFrame(canvas: HTMLCanvasElement, frame: PreviewFrame) {
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  canvas.getContext('2d')!.drawImage(frame.image, 0, 0);
}

export default function CityThumbnail({ cityId, apiBase, animate = false, active = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvases = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([null, null]);
  const frames = useRef<PreviewFrame[]>([]);
  const current = useRef<PreviewFrame | null>(null);
  const frameIndex = useRef(-1);
  const front = useRef(0);
  const visibleRef = useRef(false);
  const [frontIndex, setFrontIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [label, setLabel] = useState('Current map');

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      visibleRef.current = entries[0].isIntersecting;
      setVisible(entries[0].isIntersecting);
    });
    observer.observe(node);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(motion.matches);
    motion.addEventListener('change', updateMotion);
    return () => { observer.disconnect(); motion.removeEventListener('change', updateMotion); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let mapTimer: ReturnType<typeof setInterval> | null = null;
    frames.current = [];
    frameIndex.current = -1;
    current.current = null;
    front.current = 0;
    setFrontIndex(0);
    setReady(false);
    setLoaded(false);
    setError(false);

    const fetchCurrent = async (sheet: HTMLImageElement) => {
      const response = await fetch(`${apiBase}/v1/cities/${cityId}/map`, { signal: controller.signal });
      if (!response.ok) throw new Error('Map unavailable');
      const map = await response.json() as MapData;
      const frame = { image: renderPreview(sheet, map), label: 'Current map' };
      if (controller.signal.aborted) return null;
      current.current = frame;
      if (frameIndex.current < 0 || frameIndex.current === frames.current.length || !animate || reducedMotion) {
        const canvas = canvases.current[front.current];
        if (canvas) showFrame(canvas, frame);
        setLabel(frame.label);
      }
      setLoaded(true);
      return map;
    };

    const load = async () => {
      try {
        const sheet = await spriteSheet();
        if (controller.signal.aborted) return;
        const map = await fetchCurrent(sheet);
        if (!map || !animate || reducedMotion) return;

        const response = await fetch(`${apiBase}/v1/cities/${cityId}/snapshots?limit=500`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { snapshots?: { game_year: number }[] };
        const years = [...new Set((data.snapshots || []).map(snapshot => snapshot.game_year))].filter(Number.isFinite);
        if (years.length < 2) return;
        const count = Math.min(5, years.length);
        const picked = Array.from({ length: count }, (_, index) => years[Math.round(index * (years.length - 1) / (count - 1))]);
        const recorded: PreviewFrame[] = [];
        for (const year of picked) {
          if (controller.signal.aborted) return;
          try {
            const snapshotResponse = await fetch(`${apiBase}/v1/cities/${cityId}/snapshots/${year}`, { signal: controller.signal });
            if (!snapshotResponse.ok) continue;
            const snapshot = await snapshotResponse.json() as { tiles?: number[] };
            recorded.push({
              image: renderPreview(sheet, { tiles: snapshot.tiles || [], width: map.width, height: map.height }),
              label: `Recorded ${year}`,
            });
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        if (controller.signal.aborted || recorded.length < 2) return;
        frames.current = recorded;
        startTimer = setTimeout(() => { if (!controller.signal.aborted) setReady(true); }, Math.random() * 2500);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };

    void load();
    if (active && animate) {
      mapTimer = setInterval(() => {
        if (document.hidden || !visibleRef.current || !current.current) return;
        void spriteSheet().then(sheet => fetchCurrent(sheet)).catch(() => {});
      }, 30000);
    }
    return () => {
      controller.abort();
      if (startTimer) clearTimeout(startTimer);
      if (mapTimer) clearInterval(mapTimer);
    };
  }, [cityId, apiBase, animate, active, reducedMotion]);

  useEffect(() => {
    if (!ready || !visible || reducedMotion || !animate) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const advance = () => {
      if (cancelled) return;
      if (document.hidden) { timer = setTimeout(advance, 1000); return; }
      frameIndex.current = (frameIndex.current + 1) % (frames.current.length + 1);
      const frame = frames.current[frameIndex.current] || current.current;
      if (frame) {
        const next = 1 - front.current;
        const canvas = canvases.current[next];
        if (canvas) {
          showFrame(canvas, frame);
          front.current = next;
          setFrontIndex(next);
          setLabel(frame.label);
        }
      }
      timer = setTimeout(advance, 2400 + Math.random() * 800);
    };
    timer = setTimeout(advance, 1800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ready, visible, reducedMotion, animate]);

  return <div className="thumbnail-content" ref={containerRef}>
    {!loaded && <span className="thumbnail-message">{error ? 'Map unavailable · Open city' : 'Loading map…'}</span>}
    <canvas ref={node => { canvases.current[0] = node; }} aria-hidden="true" className="thumbnail-canvas" style={{ opacity: frontIndex === 0 ? 1 : 0 }} />
    <canvas ref={node => { canvases.current[1] = node; }} aria-hidden="true" className="thumbnail-canvas" style={{ opacity: frontIndex === 1 ? 1 : 0 }} />
    {loaded && animate && <span className="thumbnail-label" aria-hidden="true">{label}</span>}
    <style>{`
      .thumbnail-content { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .thumbnail-canvas { position: absolute; inset: 0; width: 100%; height: 100%; transition: opacity .55s ease; }
      .thumbnail-message { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-muted); font-size: .8rem; }
      .thumbnail-label { position: absolute; right: .45rem; bottom: .45rem; padding: .2rem .4rem; background: rgba(0,0,0,.74); color: #fff; font: 600 .68rem var(--system); letter-spacing: .02em; }
    `}</style>
  </div>;
}
