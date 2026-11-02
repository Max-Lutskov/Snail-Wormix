import { describe, expect, it } from 'vitest';
import { checksum, isSolid } from './mask';
import { ALPHA_SOLID, parseMapMeta, terrainFromMap, type MapData, type MapMeta } from './map';
import { addCrater, buildTerrain, createTerrainState, type TerrainState } from './state';
import { ART_SCALE } from '../world';

const W = 40;
const H = 20;
const AW = W * ART_SCALE;

function meta(overrides: Partial<MapMeta> = {}): MapMeta {
  return {
    id: 'test',
    name: 'Test',
    width: W,
    height: H,
    waterLevel: 18,
    spawns: [{ x: 5 }, { x: 35 }],
    ...overrides,
  };
}

/** Sets every art pixel of world pixel (x, y) to `value`. */
function fill(a: Uint8Array, x: number, y: number, value: number): void {
  for (let dy = 0; dy < ART_SCALE; dy++) {
    for (let dx = 0; dx < ART_SCALE; dx++) {
      a[(y * ART_SCALE + dy) * AW + x * ART_SCALE + dx] = value;
    }
  }
}

/** Art-scale alpha: ground below y = 10 everywhere, plus a floating 4×2 block at (18..21, 3..4). */
function alpha(): Uint8Array {
  const a = new Uint8Array(AW * H * ART_SCALE);
  for (let y = 10; y < H; y++) for (let x = 0; x < W; x++) fill(a, x, y, 255);
  for (let y = 3; y < 5; y++) for (let x = 18; x < 22; x++) fill(a, x, y, 200);
  return a;
}

function map(overrides: Partial<MapData> = {}): MapData {
  return { meta: meta(), alpha: alpha(), ...overrides };
}

describe('parseMapMeta', () => {
  it('accepts a valid map.json', () => {
    expect(parseMapMeta(JSON.parse(JSON.stringify(meta())))).toEqual(meta());
  });

  it.each([
    ['not an object', 42],
    ['missing id', { ...meta(), id: undefined }],
    ['fractional width', { ...meta(), width: 10.5 }],
    ['spawns not a list', { ...meta(), spawns: 'x' }],
    ['spawn without x', { ...meta(), spawns: [{ x: 1 }, {}] }],
  ])('rejects %s', (_, value) => {
    expect(() => parseMapMeta(value)).toThrow();
  });
});

describe('terrainFromMap', () => {
  it('makes world pixels whose art pixels average alpha >= 128 solid', () => {
    const a = alpha();
    fill(a, 0, 0, ALPHA_SOLID);
    fill(a, 1, 0, ALPHA_SOLID - 1);
    // A block averaging exactly 128 is solid, one alpha unit less is not.
    const block = (x: number, values: readonly number[]): void => {
      values.forEach((v, k) => {
        a[(k >> 1) * AW + x * ART_SCALE + (k & 1)] = v;
      });
    };
    block(4, [255, 255, 1, 1]);
    block(6, [255, 255, 1, 0]);
    const { mask } = terrainFromMap(map({ alpha: a }));
    expect(isSolid(mask, 0, 0)).toBe(true);
    expect(isSolid(mask, 1, 0)).toBe(false);
    expect(isSolid(mask, 4, 0)).toBe(true);
    expect(isSolid(mask, 6, 0)).toBe(false);
    expect(isSolid(mask, 19, 3)).toBe(true);
    expect(isSolid(mask, 19, 6)).toBe(false);
    expect(isSolid(mask, 30, 15)).toBe(true);
  });

  it('carries meta into the layout and has no generated decor', () => {
    const layout = terrainFromMap(map());
    expect(layout.waterLevel).toBe(18);
    expect(layout.spawns).toEqual([{ x: 5 }, { x: 35 }]);
    expect(layout.decor).toEqual([]);
    expect(layout.mossBumps).toEqual([]);
  });

  it('rejects an alpha buffer of the wrong size', () => {
    expect(() => terrainFromMap(map({ alpha: new Uint8Array(10) }))).toThrow(/size/);
  });

  it('rejects fewer than two spawns', () => {
    expect(() => terrainFromMap(map({ meta: meta({ spawns: [{ x: 5 }] }) }))).toThrow(/spawn/);
  });

  it('rejects a spawn outside the world or over no ground', () => {
    expect(() => terrainFromMap(map({ meta: meta({ spawns: [{ x: 5 }, { x: 99 }] }) }))).toThrow(
      /spawn/,
    );
    const a = alpha();
    for (let y = 0; y < H; y++) fill(a, 35, y, 0);
    expect(() => terrainFromMap(map({ alpha: a }))).toThrow(/spawn/);
  });

  it('rejects a water level outside the world', () => {
    expect(() => terrainFromMap(map({ meta: meta({ waterLevel: 25 }) }))).toThrow(/water/);
  });
});

describe('map terrain state', () => {
  const lookup = (id: string): MapData | undefined => (id === 'test' ? map() : undefined);

  it('builds and replays craters on a map source', () => {
    let state = createTerrainState({ kind: 'map', id: 'test' });
    const live = buildTerrain(state, lookup);
    state = addCrater(state, live, { x: 20, y: 12, r: 4 }).state;
    expect(isSolid(live.mask, 20, 12)).toBe(false);
    const rebuilt = buildTerrain(JSON.parse(JSON.stringify(state)) as TerrainState, lookup);
    expect(checksum(rebuilt.mask)).toBe(checksum(live.mask));
  });

  it('fails loudly when the map is not loaded', () => {
    expect(() => buildTerrain(createTerrainState({ kind: 'map', id: 'nope' }), lookup)).toThrow(
      /nope/,
    );
  });
});
