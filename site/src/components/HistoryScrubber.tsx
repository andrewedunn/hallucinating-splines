// ABOUTME: Cancellable city-history playback with labeled recorded metrics.
// ABOUTME: Supports ambient homepage replay and explicit controls without mixing recorded and current views.
import { useState, useEffect, useRef, useMemo } from 'react';
import { createSnapshotLoader } from '../lib/snapshotPlayback';

declare global { interface Window { umami?: { track: (event: string) => void }; } }
export interface Snapshot { game_year: number; population: number; funds: number; }
interface Props {
  cityId: string; apiBase: string;
  onSnapshotLoad: (tiles: number[], snapshot: Snapshot) => void;
  onReturnToCurrent?: () => void;
  autoPlay?: boolean;
}
export default function HistoryScrubber({ cityId, apiBase, onSnapshotLoad, onReturnToCurrent, autoPlay = false }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState(-1);
  const [pending, setPending] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [total, setTotal] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const playingRef = useRef(false);
  const operation = useRef(0);
  const selectedRef = useRef(-1);
  const userInteracted = useRef(false);
  const visible = useRef(false);
  const replayRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!autoPlay || !replayRef.current) return;
    const observer = new IntersectionObserver(entries => { visible.current = entries[0].isIntersecting; });
    observer.observe(replayRef.current.closest('.watch-panel') || replayRef.current);
    return () => observer.disconnect();
  }, [autoPlay]);

  useEffect(() => {
    if (!autoPlay) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReducedMotion(motion.matches);
      if (motion.matches && playingRef.current && !userInteracted.current) {
        stop();
        selectedRef.current = -1; setSelected(-1); onReturnToCurrent?.();
      }
    };
    update();
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, [autoPlay]);

  useEffect(() => {
    if (!autoPlay || initialLoading || snapshots.length < 2 || reducedMotion) return;
    const timer = setTimeout(() => { if (!userInteracted.current) void play(true); }, 1800);
    return () => clearTimeout(timer);
  }, [autoPlay, initialLoading, snapshots, reducedMotion]);

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
  async function play(ambient = false) {
    if (!ambient) userInteracted.current = true;
    if (playingRef.current) { stop(); return; }
    const token = ++operation.current;
    playingRef.current = true; setPlaying(true);
    if (!ambient) window.umami?.track('history-play');
    const count = Math.min(8, snapshots.length);
    const previewIndexes = ambient ? Array.from({ length: count }, (_, index) =>
      Math.round(index * (snapshots.length - 1) / (count - 1))) : [];
    let position = ambient ? 0 : selectedRef.current < 0 || selectedRef.current >= snapshots.length - 1 ? 0 : selectedRef.current;
    while (playingRef.current && token === operation.current && (ambient || position < snapshots.length)) {
      if (ambient && (!visible.current || document.hidden)) {
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      const index = ambient ? previewIndexes[position] : position;
      if (!await select(index, token)) break;
      await new Promise(resolve => setTimeout(resolve, ambient ? 1800 : window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1400 : 700));
      position++;
      if (ambient && position === previewIndexes.length && token === operation.current) {
        selectedRef.current = -1; setSelected(-1); onReturnToCurrent?.();
        await new Promise(resolve => setTimeout(resolve, 2200));
        position = 0;
      }
    }
    if (token === operation.current) { playingRef.current = false; setPlaying(false); }
  }
  const current = selected >= 0 ? snapshots[selected] : null;
  return <div className="replay" aria-label="City history" ref={replayRef}>
    <div className="replay-heading">
      <strong>{current ? `Recorded year ${current.game_year}` : 'Current city view'}</strong>
      {current && <span>Population {current.population.toLocaleString()} · Funds ${current.funds.toLocaleString()}</span>}
    </div>
    {initialLoading ? <p role="status">Loading recorded history…</p> : snapshots.length ? <>
      <div className="replay-controls">
        <button type="button" className="button" onClick={() => void play()} aria-pressed={playing}>{playing ? 'Pause history' : 'Play history'}</button>
        <input aria-label="Recorded year" aria-valuetext={snapshots[pending ?? selected]?.game_year ? `Year ${snapshots[pending ?? selected].game_year}` : 'Choose a recorded year'} type="range" min={0} max={snapshots.length - 1} value={pending ?? (selected < 0 ? snapshots.length - 1 : selected)} onChange={e => { userInteracted.current = true; stop(); window.umami?.track('history-scrub'); void select(Number(e.target.value), operation.current); }} />
        <button type="button" className="button button-quiet" disabled={selected < 0 && pending === null} onClick={() => { userInteracted.current = true; stop(); selectedRef.current = -1; setSelected(-1); setError(''); onReturnToCurrent?.(); }}>Current view</button>
      </div>
      <p className="replay-caption" role="status">{pending !== null ? `Loading year ${snapshots[pending].game_year}…` : `${snapshots[0].game_year}–${snapshots[snapshots.length - 1].game_year} · ${snapshots.length} recorded years${total > snapshots.length ? ` shown of ${total}` : ''}`}</p>
    </> : !error && <p>No recorded history yet. The current city is shown above.</p>}
    {error && <p className="error-message" role="alert">{error} {!snapshots.length && <button type="button" className="button button-quiet" onClick={() => setRetry(n => n + 1)}>Retry history</button>}</p>}
  </div>;
}
