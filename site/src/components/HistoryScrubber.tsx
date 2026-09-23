// ABOUTME: Explicit, cancellable city-history playback with labeled recorded metrics.
// ABOUTME: Keeps a working map on failures and supports returning to the current state.
import { useState, useEffect, useRef, useMemo } from 'react';
import { createSnapshotLoader } from '../lib/snapshotPlayback';

declare global { interface Window { umami?: { track: (event: string) => void }; } }
export interface Snapshot { game_year: number; population: number; funds: number; }
interface Props {
  cityId: string; apiBase: string;
  onSnapshotLoad: (tiles: number[], snapshot: Snapshot) => void;
  onReturnToCurrent?: () => void;
}
export default function HistoryScrubber({ cityId, apiBase, onSnapshotLoad, onReturnToCurrent }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState(-1);
  const [pending, setPending] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [total, setTotal] = useState(0);
  const playingRef = useRef(false);
  const operation = useRef(0);
  const selectedRef = useRef(-1);
  const loader = useMemo(() => createSnapshotLoader(cityId, apiBase), [cityId, apiBase]);
  useEffect(() => {
    const controller = new AbortController();
    setInitialLoading(true); setError('');
    fetch(`${apiBase}/v1/cities/${cityId}/snapshots?limit=500`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { setSnapshots(data.snapshots || []); setTotal(data.total ?? data.snapshots?.length ?? 0); })
      .catch(() => { if (!controller.signal.aborted) setError('History could not load. Try again.'); })
      .finally(() => { if (!controller.signal.aborted) setInitialLoading(false); });
    return () => { controller.abort(); playingRef.current = false; operation.current++; loader.cancel(); };
  }, [cityId, apiBase, loader, retry]);

  function stop() { playingRef.current = false; setPlaying(false); operation.current++; loader.cancel(); setPending(null); }
  async function select(index: number, token: number) {
    setPending(index); setError('');
    try {
      return await loader.load(snapshots[index].game_year, tiles => {
        selectedRef.current = index; setSelected(index);
        onSnapshotLoad(tiles, snapshots[index]);
      });
    } catch {
      if (token === operation.current) {
        setError('This recorded map could not load. Choose another year or try again.');
        playingRef.current = false; setPlaying(false);
      }
      return false;
    } finally { if (token === operation.current) setPending(null); }
  }
  async function play() {
    if (playingRef.current) { stop(); return; }
    const token = ++operation.current;
    playingRef.current = true; setPlaying(true);
    window.umami?.track('history-play');
    let index = selectedRef.current < 0 || selectedRef.current >= snapshots.length - 1 ? 0 : selectedRef.current;
    while (playingRef.current && token === operation.current && index < snapshots.length) {
      if (!await select(index, token)) break;
      await new Promise(resolve => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1400 : 700));
      index++;
    }
    if (token === operation.current) { playingRef.current = false; setPlaying(false); }
  }
  const current = selected >= 0 ? snapshots[selected] : null;
  return <div className="replay" aria-label="City history">
    <div className="replay-heading">
      <strong>{current ? `Recorded year ${current.game_year}` : 'Current city view'}</strong>
      {current && <span>Population {current.population.toLocaleString()} · Funds ${current.funds.toLocaleString()}</span>}
    </div>
    {initialLoading ? <p role="status">Loading recorded history…</p> : snapshots.length ? <>
      <div className="replay-controls">
        <button type="button" className="button" onClick={play} aria-pressed={playing}>{playing ? 'Pause history' : 'Play history'}</button>
        <input aria-label="Recorded year" aria-valuetext={snapshots[pending ?? selected]?.game_year ? `Year ${snapshots[pending ?? selected].game_year}` : 'Choose a recorded year'} type="range" min={0} max={snapshots.length - 1} value={pending ?? (selected < 0 ? snapshots.length - 1 : selected)} onChange={e => { stop(); window.umami?.track('history-scrub'); void select(Number(e.target.value), operation.current); }} />
        <button type="button" className="button button-quiet" disabled={selected < 0 && pending === null} onClick={() => { stop(); selectedRef.current = -1; setSelected(-1); setError(''); onReturnToCurrent?.(); }}>Current view</button>
      </div>
      <p className="replay-caption" role="status">{pending !== null ? `Loading year ${snapshots[pending].game_year}…` : `${snapshots[0].game_year}–${snapshots[snapshots.length - 1].game_year} · ${snapshots.length} recorded years${total > snapshots.length ? ` shown of ${total}` : ''}`}</p>
    </> : !error && <p>No recorded history yet. The current city is shown above.</p>}
    {error && <p className="error-message" role="alert">{error} {!snapshots.length && <button type="button" className="button button-quiet" onClick={() => setRetry(n => n + 1)}>Retry history</button>}</p>}
  </div>;
}
