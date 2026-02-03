// ABOUTME: Fetch wrapper for the Hallucinating Splines Workers API.
// ABOUTME: Used by all pages to load city data, stats, maps, and leaderboards.

const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://hallucinating-splines.andrew-987.workers.dev';

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}
