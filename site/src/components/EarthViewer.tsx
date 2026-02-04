// ABOUTME: Three.js globe showing all Micropolis cities as sprite-rendered textures on a sphere.
// ABOUTME: Three-phase loading: PNGs first (fast), filler cities, then sprite upgrade for detail.

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadSpriteSheet, TILE_SIZE, tileIdFromRaw, spriteCoords } from '../lib/sprites';
import {
  computeAtlasLayout, getCityRect, getFillerRects, uvToCityIndex,
  type AtlasLayout,
} from '../lib/earthLayout';

declare global {
  interface Window {
    umami?: { track: (event: string) => void };
  }
}

export interface CityMeta {
  id: string;
  name: string;
  slug: string;
  mayor: string;
  population: number;
  game_year: number;
  score: number;
  status: string;
}

interface Props {
  cities: CityMeta[];
  apiBase: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function renderCitySprites(
  ctx: CanvasRenderingContext2D,
  spriteSheet: HTMLImageElement,
  tiles: number[],
  mapWidth: number,
  mapHeight: number,
  rect: { x: number; y: number; w: number; h: number },
  tilePx: number,
) {
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const raw = tiles[y * mapWidth + x];
      const tileId = tileIdFromRaw(raw);
      const { sx, sy } = spriteCoords(tileId);
      ctx.drawImage(
        spriteSheet,
        sx, sy, TILE_SIZE, TILE_SIZE,
        rect.x + x * tilePx, rect.y + y * tilePx, tilePx, tilePx,
      );
    }
  }
}

// ── Three-phase loader ───────────────────────────────────────────────────────

async function loadAtlas(
  cities: CityMeta[],
  apiBase: string,
  atlasCanvas: HTMLCanvasElement,
  layout: AtlasLayout,
  texture: THREE.CanvasTexture,
) {
  const ctx = atlasCanvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;

  // Phase 1: Load PNGs (fast, small images)
  const loadedImages: HTMLImageElement[] = [];
  const PNG_BATCH = 6;

  for (let i = 0; i < cities.length; i += PNG_BATCH) {
    const batch = cities.slice(i, i + PNG_BATCH);
    const images = await Promise.all(
      batch.map(city =>
        loadImage(`${apiBase}/v1/cities/${city.id}/map/image?scale=2`).catch(() => null)
      ),
    );

    for (let j = 0; j < images.length; j++) {
      const img = images[j];
      const idx = i + j;
      const rect = getCityRect(idx, layout);
      if (img) {
        ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
        loadedImages[idx] = img;
      }
    }
    texture.needsUpdate = true;
  }

  // Phase 2: Fill empty cells with copies of loaded city images
  if (loadedImages.length > 0) {
    const fillerRects = getFillerRects(layout, cities.length);
    for (const rect of fillerRects) {
      const donor = loadedImages[Math.floor(Math.random() * loadedImages.length)];
      if (donor) {
        ctx.drawImage(donor, rect.x, rect.y, rect.w, rect.h);
      }
    }
    texture.needsUpdate = true;
  }

  // Phase 3: Progressive sprite upgrade (background, slower)
  // Disable smoothing for sprite rendering — keeps pixel art crisp
  ctx.imageSmoothingEnabled = false;
  const spriteSheet = await loadSpriteSheet('/tiles.png');
  const SPRITE_BATCH = 3;

  for (let i = 0; i < cities.length; i += SPRITE_BATCH) {
    const batch = cities.slice(i, i + SPRITE_BATCH);
    const results = await Promise.all(
      batch.map(city =>
        fetch(`${apiBase}/v1/cities/${city.id}/map`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      ),
    );

    for (let j = 0; j < results.length; j++) {
      const mapData = results[j];
      if (!mapData?.tiles) continue;
      const idx = i + j;
      const rect = getCityRect(idx, layout);
      renderCitySprites(ctx, spriteSheet, mapData.tiles, mapData.width, mapData.height, rect, layout.tilePx);
    }

    texture.needsUpdate = true;
    await new Promise(r => setTimeout(r, 50));
  }

  // Re-fill filler cells with sprite-quality images from the atlas
  if (cities.length > 0) {
    const fillerRects = getFillerRects(layout, cities.length);
    for (const rect of fillerRects) {
      const donorIdx = Math.floor(Math.random() * cities.length);
      const donorRect = getCityRect(donorIdx, layout);
      ctx.drawImage(
        atlasCanvas,
        donorRect.x, donorRect.y, donorRect.w, donorRect.h,
        rect.x, rect.y, rect.w, rect.h,
      );
    }
    texture.needsUpdate = true;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EarthViewer({ cities, apiBase }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverCity, setHoverCity] = useState<CityMeta | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    sphere: THREE.Mesh;
    texture: THREE.CanvasTexture;
    layout: AtlasLayout;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
  } | null>(null);

  const mouseDownPos = useRef({ x: 0, y: 0 });
  const citiesRef = useRef(cities);
  citiesRef.current = cities;

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container || cities.length === 0) return;

    const layout = computeAtlasLayout(cities.length);

    // Atlas canvas — dark fill, placeholder colors for real city cells
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = layout.width;
    atlasCanvas.height = layout.height;
    const ctx = atlasCanvas.getContext('2d')!;
    ctx.fillStyle = '#0c0c14';
    ctx.fillRect(0, 0, layout.width, layout.height);

    for (let i = 0; i < cities.length; i++) {
      const rect = getCityRect(i, layout);
      ctx.fillStyle = cities[i].status === 'ended' ? '#1a1a24' : '#141420';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080810);

    // Stars
    const starPositions = new Float32Array(3000);
    for (let i = 0; i < 3000; i++) {
      starPositions[i] = (Math.random() - 0.5) * 80;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 });
    scene.add(new THREE.Points(starGeo, starMat));

    // Camera
    const w = container.clientWidth;
    const h = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    camera.position.z = 2.8;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Sphere — segments scale with city count ("gets rounder")
    const segments = Math.min(64, Math.max(12, cities.length * 2));
    const geometry = new THREE.SphereGeometry(1, segments, segments);
    const texture = new THREE.CanvasTexture(atlasCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(1.02, segments, segments);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: 0x6366f1, transparent: true, opacity: 0.06, side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.4;
    controls.minDistance = 1.15;
    controls.maxDistance = 10;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.15;
    controls.enablePan = false;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    sceneRef.current = {
      renderer, scene, camera, controls, sphere, texture, layout, raycaster, pointer,
    };

    // Animation loop
    let animId: number;
    function animate() {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize
    const handleResize = () => {
      const rw = container.clientWidth;
      const rh = container.clientHeight;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh);
    };
    window.addEventListener('resize', handleResize);

    // Kick off three-phase loading
    loadAtlas(cities, apiBase, atlasCanvas, layout, texture);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      atmosGeo.dispose();
      atmosMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  // Raycast helper
  const raycastCity = useCallback((clientX: number, clientY: number): number | null => {
    const s = sceneRef.current;
    if (!s) return null;
    const rect = s.renderer.domElement.getBoundingClientRect();
    s.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    s.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    s.raycaster.setFromCamera(s.pointer, s.camera);
    const hits = s.raycaster.intersectObject(s.sphere);
    if (hits.length === 0 || !hits[0].uv) return null;
    return uvToCityIndex(hits[0].uv.x, hits[0].uv.y, s.layout, citiesRef.current.length);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const dx = e.clientX - mouseDownPos.current.x;
    const dy = e.clientY - mouseDownPos.current.y;
    if (dx * dx + dy * dy < 9) {
      const idx = raycastCity(e.clientX, e.clientY);
      if (idx !== null) {
        window.umami?.track('earth-city-click');
        window.location.href = `/cities/${citiesRef.current[idx].slug}`;
      }
    }
  }, [raycastCity]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const idx = raycastCity(e.clientX, e.clientY);
    if (idx !== null) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 10 });
      }
      setHoverCity(citiesRef.current[idx]);
    } else {
      setHoverCity(null);
    }
  }, [raycastCity]);

  const handlePointerLeave = useCallback(() => setHoverCity(null), []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', cursor: 'grab' }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {hoverCity && (
        <div style={{
          position: 'absolute',
          left: tooltipPos.x,
          top: tooltipPos.y,
          background: 'rgba(26, 29, 39, 0.95)',
          border: '1px solid var(--border, #2a2d37)',
          borderRadius: 8,
          padding: '8px 12px',
          pointerEvents: 'none',
          zIndex: 10,
          fontSize: 13,
          lineHeight: 1.5,
          maxWidth: 240,
          whiteSpace: 'nowrap',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontWeight: 700, color: '#e4e4e7' }}>{hoverCity.name}</div>
          <div style={{ color: '#9ca3af', fontSize: 12 }}>Mayor: {hoverCity.mayor}</div>
          <div style={{ color: '#9ca3af', fontSize: 12 }}>
            Pop: {hoverCity.population.toLocaleString()} · Year {hoverCity.game_year} · Score {hoverCity.score}
          </div>
          <div style={{ color: '#6366f1', fontSize: 11, marginTop: 2 }}>Click to visit →</div>
        </div>
      )}
    </div>
  );
}
