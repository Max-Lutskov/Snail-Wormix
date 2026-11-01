import { describe, expect, it } from 'vitest';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../world';
import { HILLS_LIMITS, generateHills } from './hills';
import { checksum, isSolid, surfaceY } from './mask';

function surfaces(seed: number): number[] {
  const { mask } = generateHills(seed);
  const out: number[] = [];
  for (let x = 0; x < mask.width; x++) {
    const y = surfaceY(mask, x);
    if (y === null) throw new Error(`column ${x} is empty`);
    out.push(y);
  }
  return out;
}

describe('generateHills', () => {
  it('fills the whole world', () => {
    const { mask } = generateHills(1);
    expect(mask.width).toBe(WORLD_WIDTH);
    expect(mask.height).toBe(WORLD_HEIGHT);
  });

  it('is deterministic for a seed', () => {
    const a = generateHills(1234);
    const b = generateHills(1234);
    expect(checksum(a.mask)).toBe(checksum(b.mask));
    expect(a.spawns).toEqual(b.spawns);
    expect(a.waterLevel).toBe(b.waterLevel);
  });

  it('gives different terrain for different seeds', () => {
    expect(checksum(generateHills(1).mask)).not.toBe(checksum(generateHills(2).mask));
  });

  it('pins the output so cross-platform drift is caught', () => {
    expect(checksum(generateHills(1).mask)).toMatchInlineSnapshot(`3857793829`);
  });

  it('keeps every column above the water and below the ceiling', () => {
    for (const seed of [1, 2, 3, 42, 9999]) {
      const { waterLevel } = generateHills(seed);
      for (const y of surfaces(seed)) {
        expect(y).toBeGreaterThanOrEqual(HILLS_LIMITS.minSurfaceY);
        expect(y).toBeLessThanOrEqual(waterLevel - HILLS_LIMITS.minLandAboveWater);
      }
    }
  });

  it('has no holes: solid from the surface to the bottom', () => {
    const { mask } = generateHills(7);
    for (let x = 0; x < mask.width; x += 37) {
      const top = surfaceY(mask, x) ?? mask.height;
      for (let y = top; y < mask.height; y++) expect(isSolid(mask, x, y)).toBe(true);
    }
  });

  it('is actually hilly', () => {
    for (const seed of [1, 2, 3]) {
      const s = surfaces(seed);
      expect(Math.max(...s) - Math.min(...s)).toBeGreaterThan(60);
    }
  });

  it('has two spawns on flat ground inside the visible area', () => {
    for (const seed of [1, 2, 3, 42]) {
      const { spawns } = generateHills(seed);
      const s = surfaces(seed);
      expect(spawns).toHaveLength(2);
      for (const { x } of spawns) {
        expect(x).toBeGreaterThan(160);
        expect(x).toBeLessThan(WORLD_WIDTH - 160);
        const flat = s.slice(
          x - HILLS_LIMITS.spawnFlatHalfWidth,
          x + HILLS_LIMITS.spawnFlatHalfWidth + 1,
        );
        expect(new Set(flat).size).toBe(1);
      }
    }
  });
});
