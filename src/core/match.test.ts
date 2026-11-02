import { describe, expect, it } from 'vitest';
import {
  aimTicksLeft,
  canHide,
  createMatch,
  NO_INPUT,
  stepMatch,
  TURN,
  type MatchEvent,
  type MatchInput,
  type MatchState,
} from './match';
import { MAX_WIND } from './projectile';
import type { TerrainLayout } from './terrain/layout';
import { checksum } from './terrain/mask';
import { buildTerrain, createTerrainState } from './terrain/state';

function setup(seed = 3): { state: MatchState; layout: TerrainLayout } {
  const terrain = createTerrainState({ kind: 'hills', seed: 1 });
  const layout = buildTerrain(terrain);
  return { state: createMatch(terrain, layout, seed), layout };
}

/** Steps until `done` or `limit` ticks; collects events. */
function runUntil(
  state: MatchState,
  layout: TerrainLayout,
  done: (s: MatchState) => boolean,
  input: MatchInput = NO_INPUT,
  limit = 5000,
): { state: MatchState; events: MatchEvent[] } {
  let s = state;
  const events: MatchEvent[] = [];
  for (let i = 0; i < limit && !done(s); i++) {
    const r = stepMatch(s, input, layout);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const SHOOT_DOWN: MatchInput = { ...NO_INPUT, fire: { angle: Math.PI / 2, power: 0.3 } };

describe('match setup', () => {
  it('puts one snail per team on the spawns, team 0 to aim, wind within bounds', () => {
    const { state } = setup();
    expect(state.snails.map((s) => s.team)).toEqual([0, 1]);
    expect(state.snails.every((s) => s.grounded && s.hp === 100)).toBe(true);
    expect(state).toMatchObject({ active: 0, phase: 'aim', turn: 1, weapon: 'pea' });
    expect(Math.abs(state.wind)).toBeLessThanOrEqual(MAX_WIND);
    expect(aimTicksLeft(state)).toBe(TURN.aimTicks);
  });
});

describe('a shot', () => {
  it('flies, carves a crater, hurts the snail it lands next to, then passes the turn', () => {
    const { state, layout } = setup();
    const before = checksum(layout.mask);
    const fired = stepMatch(state, SHOOT_DOWN, layout);
    expect(fired.state.phase).toBe('flight');
    expect(fired.events).toContainEqual({ kind: 'fire', snail: 0 });

    const landed = runUntil(fired.state, layout, (s) => s.phase !== 'flight');
    expect(landed.state.phase).toBe('retreat');
    expect(landed.events.some((e) => e.kind === 'explosion')).toBe(true);
    expect(checksum(layout.mask)).not.toBe(before);
    const self = landed.events.find((e) => e.kind === 'damage');
    expect(self).toMatchObject({ kind: 'damage', snail: 0 });
    expect(landed.state.snails[0]?.hp).toBeLessThan(100);
    expect(landed.state.terrain.craters).toHaveLength(1);

    const next = runUntil(landed.state, layout, (s) => s.phase === 'aim');
    expect(next.state).toMatchObject({ active: 1, turn: 2 });
    expect(next.events).toContainEqual({ kind: 'turn', active: 1 });
  });

  it('allows only one shot per turn', () => {
    const { state, layout } = setup();
    const a = stepMatch(state, SHOOT_DOWN, layout).state;
    const b = stepMatch(a, SHOOT_DOWN, layout).state;
    expect(b.phase).toBe('flight');
    expect(b.projectile?.age).toBe(1);
  });
});

describe('turns', () => {
  it('passes the turn when the timer runs out without a shot', () => {
    const { state, layout } = setup();
    const r = runUntil(state, layout, (s) => s.active === 1);
    expect(r.state.phase).toBe('aim');
    expect(r.state.turn).toBe(2);
  });

  it('spends limited ammo and refuses a weapon with none left', () => {
    const { state, layout } = setup();
    const pick: MatchInput = { ...NO_INPUT, weapon: 'acorn' };
    let s = stepMatch(state, pick, layout).state;
    expect(s.weapon).toBe('acorn');
    s = { ...s, ammo: s.ammo.map((a, t) => (t === 0 ? { ...a, acorn: 0 } : a)) };
    s = stepMatch({ ...s, weapon: 'pea' }, pick, layout).state;
    expect(s.weapon).toBe('pea');
  });

  it('ends with a winner when the last enemy drowns', () => {
    const { state, layout } = setup();
    const sunk: MatchState = {
      ...state,
      snails: state.snails.map((s, i) =>
        // Off the world's side, so no ground stops the fall.
        i === 1 ? { ...s, x: -60, y: layout.waterLevel - 1, grounded: false, vy: 3 } : s,
      ),
    };
    const r = runUntil(sunk, layout, (s) => s.phase === 'over');
    expect(r.state.snails[1]?.alive).toBe(false);
    expect(r.state.winner).toBe(0);
    expect(r.events).toContainEqual({ kind: 'over', winner: 0 });
  });
});

describe('hiding in the shell', () => {
  const HIDE: MatchInput = { ...NO_INPUT, hide: true };

  it('is the move of the turn: the turn passes at once', () => {
    const { state, layout } = setup();
    const r = stepMatch(state, HIDE, layout);
    expect(r.events).toContainEqual({ kind: 'hide', snail: 0 });
    expect(r.state.phase).toBe('settle');
    expect(r.state.snails[0]?.shell).toBe(true);
    const next = runUntil(r.state, layout, (s) => s.phase === 'aim');
    expect(next.state.active).toBe(1);
    expect(next.state.snails[0]?.shell).toBe(true);
  });

  it('halves the damage of a blast', () => {
    const { state } = setup();
    const hurt = (shell: boolean): number => {
      const { layout: fresh } = setup();
      const s: MatchState = {
        ...state,
        snails: state.snails.map((x, i) => (i === 0 ? { ...x, shell } : x)),
      };
      const r = runUntil(stepMatch(s, SHOOT_DOWN, fresh).state, fresh, (m) => m.phase !== 'flight');
      return 100 - (r.state.snails[0]?.hp ?? 100);
    };
    const open = hurt(false);
    expect(open).toBeGreaterThan(10);
    expect(hurt(true)).toBe(Math.round(open * 0.5));
  });

  it('ends when its own turn starts, and cannot be used two turns in a row', () => {
    const { state, layout } = setup();
    let s = stepMatch(state, HIDE, layout).state;
    // Red's turn runs out; green's turn starts out of the shell, but may not hide again.
    s = runUntil(s, layout, (m) => m.active === 0 && m.phase === 'aim').state;
    expect(s.snails[0]).toMatchObject({ shell: false, shellCooldown: true });
    expect(canHide(s)).toBe(false);
    expect(stepMatch(s, HIDE, layout).state.phase).toBe('aim');
    // After a turn without hiding, it may hide again.
    s = runUntil(s, layout, (m) => m.active === 1).state;
    s = runUntil(s, layout, (m) => m.active === 0 && m.phase === 'aim').state;
    expect(canHide(s)).toBe(true);
  });
});

describe('match determinism', () => {
  it('replays the same inputs to the same state', () => {
    const inputs: MatchInput[] = [];
    for (let i = 0; i < 1500; i++) {
      inputs.push(
        i === 40
          ? { ...NO_INPUT, fire: { angle: -1.1, power: 0.8 } }
          : { ...NO_INPUT, move: i < 30 ? 1 : 0 },
      );
    }
    const play = (): MatchState => {
      const { state, layout } = setup(9);
      return inputs.reduce((s, input) => stepMatch(s, input, layout).state, state);
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});
