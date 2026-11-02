import { describe, expect, it } from 'vitest';
import { planMove } from './bot';
import { createMatch, NO_INPUT, stepMatch, type MatchEvent, type MatchState } from './match';
import { seedRng } from './rng';
import type { TerrainLayout } from './terrain/layout';
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
});
