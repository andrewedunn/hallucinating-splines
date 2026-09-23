// ABOUTME: Loads recorded city maps while allowing only the newest selection to commit.
// ABOUTME: Cancelling a replay invalidates pending requests and preserves the current map.
export function createSnapshotLoader(cityId: string, apiBase: string, fetcher: typeof fetch = fetch) {
  let generation = 0;
  const cache = new Map<number, number[]>();
  return {
    cancel() { generation++; },
    async load(year: number, commit: (tiles: number[]) => void): Promise<boolean> {
      const request = ++generation;
      let tiles = cache.get(year);
      if (!tiles) {
        const response = await fetcher(`${apiBase}/v1/cities/${cityId}/snapshots/${year}`);
        if (!response.ok) throw new Error('Snapshot unavailable');
        const data = await response.json() as { tiles?: number[] };
        if (!Array.isArray(data.tiles) || !data.tiles.length) throw new Error('Snapshot unavailable');
        tiles = data.tiles;
        cache.set(year, tiles);
      }
      if (request !== generation) return false;
      commit(tiles);
      return true;
    },
  };
}
