// ABOUTME: Tests for the seeded PRNG module.
// ABOUTME: Verifies deterministic sequences and Math.random replacement via withSeed().

import { mulberry32, withSeed } from '../src/seededRandom';

describe('mulberry32', () => {
  test('same seed produces same sequence', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  test('different seeds produce different sequences', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(99);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).not.toEqual(seq2);
  });

  test('values are in [0, 1) range', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('withSeed', () => {
  test('replaces Math.random during synchronous callback', () => {
    const values: number[] = [];
    withSeed(42, () => {
      values.push(Math.random(), Math.random(), Math.random());
    });

    // Same seed should produce same values
    const expected: number[] = [];
    withSeed(42, () => {
      expected.push(Math.random(), Math.random(), Math.random());
    });

    expect(values).toEqual(expected);
  });

  test('restores original Math.random after callback', () => {
    const originalRandom = Math.random;
    withSeed(42, () => {
      // inside, Math.random is replaced
      expect(Math.random).not.toBe(originalRandom);
    });
    expect(Math.random).toBe(originalRandom);
  });

  test('restores Math.random even if callback throws', () => {
    const originalRandom = Math.random;
    expect(() => {
      withSeed(42, () => {
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(Math.random).toBe(originalRandom);
  });

  test('returns the callback return value', () => {
    const result = withSeed(42, () => 'hello');
    expect(result).toBe('hello');
  });
});
