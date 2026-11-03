import { describe, expect, it } from 'vitest';
import { inDanger, planMove, planPosition, planRetreat } from './bot';
import { createMatch, NO_INPUT, stepMatch, type MatchEvent, type MatchState } from './match';
import { seedRng } from './rng';
import type { TerrainLayout } from './terrain/layout';
import { createMask, type TerrainMask } from './terrain/mask';
import { spawnSnail } from './snail/snail';
import { buildTerrain, createTerrainState } from './terrain/state';

/** A match on hills, past the intro, with the bot (team 1) to move. */
function botTurn(seed: number): { state: MatchState; layout: TerrainLayout } {
  const terrain = createTerrainState({ kind: 'hills', seed });
  const layout = buildTerrain(terrain);
  let state = createMatch(terrain, layout, seed);
  state = { ...state, active: 1 };
  while (state.phase === 'intro') state = stepMatch(state, NO_INPUT, layout).state;
  return { state, layout };
}

/** Plays the bot's move and returns the damage it did to each team. */
function play(state: MatchState, layout: TerrainLayout, seed: number): Map<number, number> {
  const { move } = planMove(state, layout, 'hard', seedRng(seed));
  expect(move.kind).toBe('shoot');
  if (move.kind !== 'shoot') return new Map();
  let s = stepMatch(state, { ...NO_INPUT, weapon: move.weapon }, layout).state;
  const events: MatchEvent[] = [];
  const r = stepMatch(s, { ...NO_INPUT, fire: move.aim }, layout);
  s = r.state;
  events.push(...r.events);
  for (let i = 0; i < 900 && s.phase === 'flight'; i++) {
    const step = stepMatch(s, NO_INPUT, layout);
    s = step.state;
    events.push(...step.events);
  }
  const hurt = new Map<number, number>();
  for (const e of events) {
    if (e.kind !== 'damage') continue;
    const team = state.snails.find((x) => x.id === e.snail)?.team ?? -1;
    hurt.set(team, (hurt.get(team) ?? 0) + e.amount);
  }
  return hurt;
}

describe('bot', () => {
  it('a hard bot hits the enemy and not itself', () => {
    let hits = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { state, layout } = botTurn(seed);
      const hurt = play(state, layout, seed);
      expect(hurt.get(1) ?? 0).toBe(0);
      if ((hurt.get(0) ?? 0) > 0) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(3);
  });

  it('decides the same way from the same state and seed', () => {
    const { state, layout } = botTurn(5);
    const a = planMove(state, layout, 'normal', seedRng(42));
    const b = planMove(state, layout, 'normal', seedRng(42));
    expect(a).toEqual(b);
  });

  it('sometimes hides when low on health', () => {
    const { state, layout } = botTurn(6);
    const weak: MatchState = {
      ...state,
      snails: state.snails.map((s, i) => (i === 1 ? { ...s, hp: 20 } : s)),
    };
    const kinds = new Set<string>();
    for (let seed = 0; seed < 20; seed++)
      kinds.add(planMove(weak, layout, 'easy', seedRng(seed)).move.kind);
    expect(kinds).toEqual(new Set(['hide', 'shoot']));
  });

  it('picks a safe crawl (or none) before shooting, the same way from the same seed', () => {
    for (const seed of [1, 2, 3]) {
      const { state, layout } = botTurn(seed);
      const a = planPosition(state, layout, seedRng(seed));
      expect(a).toEqual(planPosition(state, layout, seedRng(seed)));
      if (!a.crawl) continue;
      // Crawling as planned keeps the bot on the ground, out of the water.
      let s = stepMatch(state, NO_INPUT, layout).state;
      for (let i = 0; i < a.crawl.ticks; i++) {
        s = stepMatch(s, { ...NO_INPUT, move: a.crawl.dir }, layout).state;
      }
      expect(s.snails[1]).toMatchObject({ alive: true, grounded: true });
    }
  });

  it('retreats away from the enemy after shooting', () => {
    const { state, layout } = botTurn(2);
    const { crawl } = planRetreat(state, layout, seedRng(1));
    const me = state.snails[1];
    const enemy = state.snails[0];
    if (crawl && me && enemy) expect(crawl.dir).toBe(me.x >= enemy.x ? 1 : -1);
  });

  it('knows a spot by the edge over the water is dangerous, and the middle is not', () => {
    // A 600 px wide plateau ending in a cliff over the water.
    const mask = createMask(1000, 500);
    for (let y = 300; y < 500; y++) mask.data.fill(1, y * 1000 + 100, y * 1000 + 700);
    const world = { mask, waterLevel: 480 };
    expect(inDanger(spawnSnail(0, 1, 690, world), world)).toBe(true);
    expect(inDanger(spawnSnail(0, 1, 400, world), world)).toBe(false);
  });

  it('bores toward an enemy hiding under a thick roof with the drill', () => {
    const mask = createMask(900, 400);
    const fill = (m: TerrainMask, x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = y0; y < y1; y++) m.data.fill(1, y * m.width + x0, y * m.width + x1);
    };
    fill(mask, 0, 320, 900, 400); // the floor
    fill(mask, 380, 150, 760, 250); // a thick roof over the enemy's closed cave
    fill(mask, 380, 250, 400, 320); // cave walls
    fill(mask, 740, 250, 760, 320);
    const layout: TerrainLayout = {
      mask,
      waterLevel: 395,
      spawns: [{ x: 560 }, { x: 120 }],
      decor: [],
      mossBumps: [],
      decorPixels: [],
      decorAlive: new Uint8Array(0),
    };
    const terrain = createTerrainState({ kind: 'hills', seed: 1 });
    let state = { ...createMatch(terrain, layout, 1), active: 1 };
    // The enemy starts on the roof; put it in the cave below.
    state = {
      ...state,
      snails: state.snails.map((s, i) => (i === 0 ? { ...s, y: 320 } : s)),
    };
    while (state.phase === 'intro') state = stepMatch(state, NO_INPUT, layout).state;
    const { move } = planMove(state, layout, 'hard', seedRng(3));
    expect(move).toMatchObject({ kind: 'shoot', weapon: 'dandelion' });
  });
});
