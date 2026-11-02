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

  describe('decor', () => {
    function firstMushroom(seed: number) {
      const s0 = createTerrainState({ kind: 'hills', seed });
      const layout = buildTerrain(s0);
      const index = layout.decor.findIndex((d) => d.kind === 'mushroom');
      const m = layout.decor[index];
      if (!m || m.kind !== 'mushroom') throw new Error('no mushroom');
      return { s0, layout, index, m };
    }

    it('starts with every decor item standing', () => {
      const { layout } = firstMushroom(3);
      expect([...layout.decorAlive].every((v) => v === 1)).toBe(true);
      expect(layout.decorPixels).toHaveLength(layout.decor.length);
    });

    it('destroys decor a crater touches and clears all of its pixels', () => {
      const { s0, layout, index, m } = firstMushroom(3);
      const cap = { x: m.x, y: m.y - Math.round(18 * m.scale) };
      // A small crater inside the cap, off-center: the rest of the mushroom must vanish too.
      const { removedDecor } = addCrater(s0, layout, { x: m.x + 6 * m.scale, y: cap.y, r: 3 });
      expect(removedDecor).toContain(index);
      expect(layout.decorAlive[index]).toBe(0);
      expect(isSolid(layout.mask, cap.x, cap.y)).toBe(false);
      for (const p of layout.decorPixels[index] ?? []) expect(layout.mask.data[p]).toBe(0);
    });

    it('destroys decor whose support is carved out from under it', () => {
      const { s0, layout, index, m } = firstMushroom(4);
      // Reaches up to the support pixel (m.y + 1) but not the mushroom's own pixels.
      const { removedDecor } = addCrater(s0, layout, { x: m.x, y: m.y + 20, r: 19 });
      expect(removedDecor).toContain(index);
      expect(isSolid(layout.mask, m.x, m.y - 10)).toBe(false);
    });

    it('leaves decor alone when the crater is elsewhere', () => {
      const { s0, layout, index, m } = firstMushroom(5);
      const far = m.x > 800 ? 200 : 1400;
      const { removedDecor } = addCrater(s0, layout, { x: far, y: 600, r: 30 });
      expect(removedDecor).not.toContain(index);
      expect(layout.decorAlive[index]).toBe(1);
    });

    it('replays decor destruction identically from saved state', () => {
      const { s0, layout, m } = firstMushroom(6);
      const s1 = addCrater(s0, layout, { x: m.x, y: m.y + 30, r: 36 }).state;
      const rebuilt = buildTerrain(JSON.parse(JSON.stringify(s1)) as TerrainState);
      expect([...rebuilt.decorAlive]).toEqual([...layout.decorAlive]);
      expect(checksum(rebuilt.mask)).toBe(checksum(layout.mask));
    });
  });

  it('logs craters that hit only air too, so replays stay aligned', () => {
    const s0 = createTerrainState({ kind: 'hills', seed: 1 });
    const layout = buildTerrain(s0);
    const { state, changed } = addCrater(s0, layout, { x: 800, y: 10, r: 20 });
    expect(changed).toBeNull();
    expect(state.craters).toHaveLength(1);
  });
});
