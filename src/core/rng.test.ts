import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, seedRng, type RngState } from './rng';

function floats(state: RngState, count: number): number[] {
  const out: number[] = [];
  let s = state;
  for (let i = 0; i < count; i++) {
    const r = nextFloat(s);
    out.push(r.value);
    s = r.state;
  }
  return out;
}

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(floats(seedRng(42), 100)).toEqual(floats(seedRng(42), 100));
  });

  it('produces different sequences for different seeds', () => {
    expect(floats(seedRng(1), 10)).not.toEqual(floats(seedRng(2), 10));
  });

  it('keeps floats in [0, 1)', () => {
    for (const v of floats(seedRng(7), 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is a pure function of its state', () => {
    const s = seedRng(123);
    expect(nextFloat(s)).toEqual(nextFloat(s));
  });

  it('survives a JSON round-trip of its state', () => {
    let s = seedRng(99);
    for (let i = 0; i < 5; i++) s = nextFloat(s).state;
    const restored = JSON.parse(JSON.stringify({ rng: s })) as { rng: RngState };
    expect(floats(restored.rng, 20)).toEqual(floats(s, 20));
  });

  it('pins the sequence so cross-platform drift is caught', () => {
    expect(floats(seedRng(42), 3)).toMatchInlineSnapshot(`
      [
        0.6011037519201636,
        0.44829055899754167,
        0.8524657934904099,
      ]
    `);
  });

  it('returns integers within an inclusive range', () => {
    let s = seedRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const r = nextInt(s, 1, 6);
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(1);
      expect(r.value).toBeLessThanOrEqual(6);
      seen.add(r.value);
      s = r.state;
    }
    expect(seen.size).toBe(6);
  });

  it('rejects an invalid integer range', () => {
    expect(() => nextInt(seedRng(1), 5, 1)).toThrow(RangeError);
    expect(() => nextInt(seedRng(1), 0.5, 2)).toThrow(RangeError);
  });
});
