import { describe, expect, it } from 'vitest';
import { checksum, isSolid, surfaceY } from './mask';
import { addCrater, buildTerrain, createTerrainState, type TerrainState } from './state';

describe('terrain state', () => {
  it('starts with no craters', () => {
    expect(createTerrainState({ kind: 'hills', seed: 5 })).toEqual({
      source: { kind: 'hills', seed: 5 },
      craters: [],
    });
  });

  it('carves the live mask and logs the crater without mutating the old state', () => {
    const s0 = createTerrainState({ kind: 'hills', seed: 5 });
    const layout = buildTerrain(s0);
    const x = 800;
    const top = surfaceY(layout.mask, x) ?? 0;

    const { state: s1, changed } = addCrater(s0, layout, { x, y: top + 10, r: 30 });

    expect(s0.craters).toHaveLength(0);
    expect(s1.craters).toEqual([{ x, y: top + 10, r: 30 }]);
    expect(isSolid(layout.mask, x, top + 10)).toBe(false);
    expect(changed).not.toBeNull();
  });

  it('rebuilds the exact same mask from a JSON round-trip of the state', () => {
    let state = createTerrainState({ kind: 'hills', seed: 77 });
    const live = buildTerrain(state);
    const shots = [
      { x: 400.25, y: 380.5, r: 35 },
      { x: 410, y: 420, r: 50 },
      { x: 1200.75, y: 300, r: 25 },
      { x: 5, y: 700, r: 60 },
    ];
    for (const c of shots) state = addCrater(state, live, c).state;

    const restored = JSON.parse(JSON.stringify(state)) as TerrainState;
    expect(checksum(buildTerrain(restored).mask)).toBe(checksum(live.mask));
  });

  it('logs craters that hit only air too, so replays stay aligned', () => {
    const s0 = createTerrainState({ kind: 'hills', seed: 1 });
    const layout = buildTerrain(s0);
    const { state, changed } = addCrater(s0, layout, { x: 800, y: 10, r: 20 });
    expect(changed).toBeNull();
    expect(state.craters).toHaveLength(1);
  });
});
