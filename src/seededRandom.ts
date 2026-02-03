// ABOUTME: Deterministic PRNG (mulberry32) and a utility to temporarily replace Math.random.
// ABOUTME: Used for reproducible map generation from a seed value.

/**
 * Creates a mulberry32 PRNG function from a 32-bit seed.
 * Returns values in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Temporarily replaces Math.random with a seeded PRNG for the duration
 * of a synchronous callback. Restores the original afterwards (even on throw).
 */
export function withSeed<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
