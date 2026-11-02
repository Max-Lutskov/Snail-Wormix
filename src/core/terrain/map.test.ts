import { describe, expect, it } from 'vitest';
import { checksum, isSolid } from './mask';
import { ALPHA_SOLID, parseMapMeta, terrainFromMap, type MapData, type MapMeta } from './map';
import { addCrater, buildTerrain, createTerrainState, type TerrainState } from './state';

const W = 40;
const H = 20;

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

/** Ground below y = 10 everywhere, plus a floating 4×2 block at (18..21, 3..4). */
function alpha(): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 10; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = 255;
  for (let y = 3; y < 5; y++) for (let x = 18; x < 22; x++) a[y * W + x] = 200;
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
  it('makes pixels with alpha >= 128 solid', () => {
    const a = alpha();
    a[0] = ALPHA_SOLID;
    a[1] = ALPHA_SOLID - 1;
    const { mask } = terrainFromMap(map({ alpha: a }));
    expect(isSolid(mask, 0, 0)).toBe(true);
    expect(isSolid(mask, 1, 0)).toBe(false);
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
    for (let y = 0; y < H; y++) a[y * W + 35] = 0;
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
