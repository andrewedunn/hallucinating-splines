// ABOUTME: Featured city observatory using the real map and recorded history.
// ABOUTME: Loads only public data and keeps recorded and current views distinct.
import { useEffect, useState, useRef } from 'react';
import MapViewer from './MapViewer';
import HistoryScrubber from './HistoryScrubber';
interface MapData { tiles: number[]; width: number; height: number; }
export default function FeaturedCity({ cityId, apiBase, name, active = false }: { cityId: string; apiBase: string; name: string; active?: boolean }) {
  const [map, setMap] = useState<MapData | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const current = useRef<MapData | null>(null);
  const recorded = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      await fetch(`${apiBase}/v1/cities/${cityId}/map`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => { if (!Array.isArray(data.tiles)) throw new Error(); if (controller.signal.aborted) return; setError(false); current.current = data; if (!recorded.current) setMap(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { refreshing = false; });
    };
    void refresh();
    const timer = active ? setInterval(() => { if (!document.hidden) void refresh(); }, 15000) : null;
    return () => { controller.abort(); if (timer) clearInterval(timer); };
  }, [cityId, apiBase, retry, active]);
  return <div className="featured-viewer">
    {map ? <MapViewer tiles={map.tiles} width={map.width} height={map.height} label={`Map of ${name}`} /> : <div className="map-placeholder" role="status">{error ? <><p>The city map could not load.</p><button className="button button-quiet" onClick={() => setRetry(n => n + 1)}>Retry map</button></> : 'Loading the city map…'}</div>}
    {map && <HistoryScrubber cityId={cityId} apiBase={apiBase} onSnapshotLoad={tiles => { recorded.current = true; setMap(previous => previous ? { ...previous, tiles } : previous); }} onReturnToCurrent={() => { recorded.current = false; setMap(current.current); }} />}
    {map && error && <p className="error-message" role="status">The current map could not refresh. Showing the last available view.</p>}
  </div>;
}
