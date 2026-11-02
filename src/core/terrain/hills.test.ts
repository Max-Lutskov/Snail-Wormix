import { describe, expect, it } from 'vitest';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../world';
import { MUSHROOM_BOUNDS, mushroomPartAt } from './decor';
import { HILLS_LIMITS, MOSS_FUZZ, generateHills } from './hills';
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
    expect(checksum(generateHills(1).mask)).toMatchInlineSnapshot(`754993053`);
  });

  it('keeps every column above the water and below the ceiling', () => {
    for (const seed of [1, 2, 3, 42, 9999]) {
      const { waterLevel } = generateHills(seed);
      for (const y of surfaces(seed)) {
        // Mushrooms may stick up above the highest allowed ground.
        expect(y).toBeGreaterThanOrEqual(HILLS_LIMITS.minSurfaceY + MUSHROOM_BOUNDS.top);
        expect(y).toBeLessThanOrEqual(waterLevel - HILLS_LIMITS.minLandAboveWater);
      }
    }
  });

  it('has no holes: solid from the surface to the bottom (away from mushroom caps)', () => {
    const { mask, decor } = generateHills(7);
    const nearMushroom = (x: number) =>
      decor.some((d) => x >= d.x + MUSHROOM_BOUNDS.left && x <= d.x + MUSHROOM_BOUNDS.right);
    for (let x = 0; x < mask.width; x += 37) {
      if (nearMushroom(x)) continue;
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
        // Flat up to the moss fuzz bumps.
        const pad = s.slice(
          x - HILLS_LIMITS.spawnFlatHalfWidth,
          x + HILLS_LIMITS.spawnFlatHalfWidth + 1,
        );
        expect(Math.max(...pad) - Math.min(...pad)).toBeLessThanOrEqual(MOSS_FUZZ.radius);
      }
    }
  });

  it('scallops the moss edge into bumps', () => {
    const s = surfaces(3);
    const { spawns } = generateHills(3);
    const x0 = (spawns[0]?.x ?? 0) - HILLS_LIMITS.spawnFlatHalfWidth;
    const pad = s.slice(x0, x0 + 2 * MOSS_FUZZ.spacing);
    expect(new Set(pad).size).toBeGreaterThan(1);
  });

  it('places mushrooms on the ground, away from spawns, stamped into the mask', () => {
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { mask, decor, spawns } = generateHills(seed);
      total += decor.length;
      for (const m of decor) {
        expect(m.kind).toBe('mushroom');
        expect(isSolid(mask, m.x, m.y + 1)).toBe(true);
        for (const { x } of spawns) expect(Math.abs(m.x - x)).toBeGreaterThan(80);
        expect(mushroomPartAt(0, -18)).toBe('cap');
        expect(isSolid(mask, m.x, m.y - 18)).toBe(true);
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it('places decor deterministically', () => {
    expect(generateHills(9).decor).toEqual(generateHills(9).decor);
  });
});
