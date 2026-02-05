// ABOUTME: Timeline slider for scrubbing through city history snapshots.
// ABOUTME: Loads snapshot list, fetches tile data on demand when user scrubs. Play button auto-advances.

import { useState, useEffect, useCallback, useRef } from 'react';

declare global {
  interface Window {
    umami?: { track: (event: string) => void };
  }
}

interface Snapshot {
  game_year: number;
  population: number;
  funds: number;
}

interface Props {
  cityId: string;
  apiBase: string;
  onSnapshotLoad: (tiles: number[]) => void;
}

export default function HistoryScrubber({ cityId, apiBase, onSnapshotLoad }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  const playingRef = useRef(false);
  const selectedRef = useRef(selectedIndex);
  const snapshotsRef = useRef(snapshots);
  const tileCache = useRef<Map<number, number[]>>(new Map());

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { selectedRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => { snapshotsRef.current = snapshots; }, [snapshots]);

  useEffect(() => {
    fetch(`${apiBase}/v1/cities/${cityId}/snapshots?limit=500`)
      .then(r => r.json())
      .then((data: any) => {
        setSnapshots(data.snapshots || []);
        if (data.snapshots?.length > 0) {
          setSelectedIndex(data.snapshots.length - 1);
        }
      });
  }, [cityId, apiBase]);

  const hasScrubbed = useRef(false);

  const fetchTiles = useCallback(async (year: number): Promise<number[]> => {
    const cached = tileCache.current.get(year);
    if (cached) return cached;
    const res = await fetch(`${apiBase}/v1/cities/${cityId}/snapshots/${year}`);
    const data = await res.json();
    tileCache.current.set(year, data.tiles);
    return data.tiles;
  }, [cityId, apiBase]);

  const loadSnapshot = useCallback(async (index: number) => {
    const snaps = snapshotsRef.current;
    if (index < 0 || index >= snaps.length) return;
    if (!hasScrubbed.current) {
      hasScrubbed.current = true;
      window.umami?.track('history-scrub');
    }
    setSelectedIndex(index);
    setLoading(true);
    try {
      const tiles = await fetchTiles(snaps[index].game_year);
      onSnapshotLoad(tiles);
    } finally {
      setLoading(false);
    }
  }, [fetchTiles, onSnapshotLoad]);

  const playTimelapse = useCallback(async () => {
    window.umami?.track('history-play');
    setPlaying(true);
    playingRef.current = true;

    // Start from beginning if at the end
    const snaps = snapshotsRef.current;
    let idx = selectedRef.current >= snaps.length - 1 ? 0 : selectedRef.current;

    while (idx < snaps.length && playingRef.current) {
      setSelectedIndex(idx);
      selectedRef.current = idx;
      setLoading(true);

      try {
        // Fetch current and pre-fetch next in parallel
        const fetches: Promise<number[]>[] = [fetchTiles(snaps[idx].game_year)];
        if (idx + 1 < snaps.length) {
          fetches.push(fetchTiles(snaps[idx + 1].game_year));
        }
        const [tiles] = await Promise.all(fetches);
        if (!playingRef.current) break;
        onSnapshotLoad(tiles);
      } finally {
        setLoading(false);
      }

      // Wait between frames — faster for cached, slower for network
      const nextCached = idx + 1 < snaps.length && tileCache.current.has(snaps[idx + 1].game_year);
      await new Promise(r => setTimeout(r, nextCached ? 150 : 400));
      idx++;
    }

    setPlaying(false);
    playingRef.current = false;
  }, [fetchTiles, onSnapshotLoad]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      playingRef.current = false;
    } else {
      playTimelapse();
    }
  }, [playing, playTimelapse]);

  if (snapshots.length === 0) return null;

  const current = snapshots[selectedIndex] || snapshots[snapshots.length - 1];

  const btnStyle: React.CSSProperties = {
    background: playing ? 'var(--accent, #6366f1)' : 'var(--border, #333)',
    border: 'none',
    color: playing ? 'white' : 'var(--text-muted, #888)',
    width: 36,
    height: 36,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 16,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 0.15s, color 0.15s',
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
        <span>Year {current.game_year}</span>
        <span>Pop: {current.population.toLocaleString()}</span>
        <span>{loading ? 'Loading...' : `${selectedIndex + 1} / ${snapshots.length}`}</span>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button onClick={togglePlay} style={btnStyle} title={playing ? 'Pause' : 'Play timelapse'}>
          {playing ? '\u23F8' : '\u25B6'}
        </button>
        <input
          type="range"
          min={0}
          max={snapshots.length - 1}
          value={selectedIndex}
          onChange={(e) => {
            if (playing) { setPlaying(false); playingRef.current = false; }
            loadSnapshot(parseInt(e.target.value));
          }}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}
