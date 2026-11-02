import { describe, expect, it } from 'vitest';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../world';
import { decorBounds, decorCovers, type Decor } from './decor';
import { DECOR, HILLS_LIMITS, MOSS_FUZZ, generateHills } from './hills';
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
    expect(checksum(generateHills(1).mask)).toMatchInlineSnapshot(`2704743009`);
  });

  it('keeps every column above the water and below the ceiling', () => {
    for (const seed of [1, 2, 3, 42, 9999]) {
      const { waterLevel } = generateHills(seed);
      for (const y of surfaces(seed)) {
        // Decor (the biggest mushroom) may stick up above the highest allowed ground.
        expect(y).toBeGreaterThanOrEqual(HILLS_LIMITS.minSurfaceY - 32);
        expect(y).toBeLessThanOrEqual(waterLevel - HILLS_LIMITS.minLandAboveWater);
      }
    }
  });

  it('has no holes: solid from the surface to the bottom (away from decor)', () => {
    const { mask, decor } = generateHills(7);
    const nearDecor = (x: number) =>
      decor.some((d) => {
        const b = decorBounds(d);
        return x >= b.left && x <= b.right;
      });
    for (let x = 0; x < mask.width; x += 7) {
      if (nearDecor(x)) continue;
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
        expect(Math.max(...pad) - Math.min(...pad)).toBeLessThanOrEqual(MOSS_FUZZ.heightMax);
      }
    }
  });

  it('scallops the moss edge into bumps', () => {
    const s = surfaces(3);
    const { spawns } = generateHills(3);
    const x0 = (spawns[0]?.x ?? 0) - HILLS_LIMITS.spawnFlatHalfWidth;
    const pad = s.slice(x0, x0 + 2 * MOSS_FUZZ.spacingMax);
    expect(new Set(pad).size).toBeGreaterThan(1);
  });

  it('makes irregular moss bumps within the art spec ranges', () => {
    const { mossBumps } = generateHills(5);
    expect(mossBumps.length).toBeGreaterThan(40);
    const diameters = new Set(mossBumps.map((b) => b.diameter));
    expect(diameters.size).toBeGreaterThan(3);
    for (let i = 0; i < mossBumps.length; i++) {
      const b = mossBumps[i];
      if (!b) continue;
      expect(b.diameter).toBeGreaterThanOrEqual(MOSS_FUZZ.diameterMin);
      expect(b.diameter).toBeLessThanOrEqual(MOSS_FUZZ.diameterMax);
      expect(b.height).toBeGreaterThanOrEqual(MOSS_FUZZ.heightMin);
      expect(b.height).toBeLessThanOrEqual(MOSS_FUZZ.heightMax);
      const prev = mossBumps[i - 1];
      if (prev) expect(b.x - prev.x).toBeGreaterThanOrEqual(MOSS_FUZZ.spacingMin);
    }
    // Some slots are skipped, so some gaps are wider than the max spacing.
    const gaps = mossBumps.slice(1).map((b, i) => b.x - (mossBumps[i]?.x ?? 0));
    expect(Math.max(...gaps)).toBeGreaterThan(MOSS_FUZZ.spacingMax);
  });

  function byKind<K extends Decor['kind']>(decor: readonly Decor[], kind: K) {
    return decor.filter((d): d is Extract<Decor, { kind: K }> => d.kind === kind);
  }

  it('places 4-5 mushroom spots per map, some as big+small pairs, on the ground', () => {
    let pairs = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { mask, decor, spawns } = generateHills(seed);
      const mushrooms = byKind(decor, 'mushroom');
      const spots = mushrooms.filter((m) => m.scale >= 1);
      expect(spots.length).toBeGreaterThanOrEqual(DECOR.mushrooms.countMin - 1);
      expect(spots.length).toBeLessThanOrEqual(DECOR.mushrooms.countMax);
      pairs += mushrooms.filter((m) => m.scale === DECOR.mushrooms.smallScale).length;
      for (const m of mushrooms) {
        expect(isSolid(mask, m.x, m.y + 1)).toBe(true);
        expect(isSolid(mask, m.x, m.y - Math.round(14 * m.scale))).toBe(true);
        for (const { x } of spawns) expect(Math.abs(m.x - x)).toBeGreaterThan(60);
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('places dew drops and grass tufts that are part of the mask', () => {
    for (const seed of [1, 2, 3]) {
      const { mask, decor } = generateHills(seed);
      const dew = byKind(decor, 'dew');
      expect(dew.length).toBeGreaterThanOrEqual(DECOR.dew.countMin);
      expect(dew.length).toBeLessThanOrEqual(DECOR.dew.countMax);
      expect(byKind(decor, 'grass').length).toBeGreaterThan(5);
      for (const d of decor) {
        const b = decorBounds(d);
        for (let y = b.top; y <= b.bottom; y++)
          for (let x = b.left; x <= b.right; x++)
            if (decorCovers(d, x, y)) expect(isSolid(mask, x, y)).toBe(true);
      }
    }
  });

  it('places decor deterministically', () => {
    expect(generateHills(9).decor).toEqual(generateHills(9).decor);
    expect(generateHills(9).mossBumps).toEqual(generateHills(9).mossBumps);
  });
});
