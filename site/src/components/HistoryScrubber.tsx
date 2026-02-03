// ABOUTME: Timeline slider for scrubbing through city history snapshots.
// ABOUTME: Loads snapshot list, fetches tile data on demand when user scrubs.

import { useState, useEffect, useCallback } from 'react';

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

  useEffect(() => {
    fetch(`${apiBase}/v1/cities/${cityId}/snapshots?limit=100`)
      .then(r => r.json())
      .then((data: any) => {
        setSnapshots(data.snapshots || []);
        if (data.snapshots?.length > 0) {
          setSelectedIndex(data.snapshots.length - 1);
        }
      });
  }, [cityId, apiBase]);

  const loadSnapshot = useCallback(async (index: number) => {
    if (index < 0 || index >= snapshots.length) return;
    setSelectedIndex(index);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/v1/cities/${cityId}/snapshots/${snapshots[index].game_year}`);
      const data = await res.json();
      onSnapshotLoad(data.tiles);
    } finally {
      setLoading(false);
    }
  }, [snapshots, cityId, apiBase, onSnapshotLoad]);

  if (snapshots.length === 0) return null;

  const current = snapshots[selectedIndex] || snapshots[snapshots.length - 1];

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
        <span>Year {current.game_year}</span>
        <span>Pop: {current.population.toLocaleString()}</span>
        <span>{loading ? 'Loading...' : `${selectedIndex + 1} / ${snapshots.length}`}</span>
      </div>
      <input
        type="range"
        min={0}
        max={snapshots.length - 1}
        value={selectedIndex}
        onChange={(e) => loadSnapshot(parseInt(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}
