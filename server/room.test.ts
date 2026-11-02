import { describe, expect, it } from 'vitest';
import {
  createMatch,
  matchChecksum,
  NO_INPUT,
  stepMatch,
  type MatchInput,
  type MatchState,
} from '../src/core/match';
import type { TerrainLayout } from '../src/core/terrain/layout';
import { buildTerrain, createTerrainState } from '../src/core/terrain/state';
import type { ServerMessage } from '../src/net/protocol';
import { loadMaps } from './maps';
import { Room, type Peer } from './room';

const maps = loadMaps('public/maps');

/** A client that records messages and replays the ticks like the game does. */
class FakeClient implements Peer {
  readonly got: ServerMessage[] = [];
  match: MatchState | null = null;
  layout: TerrainLayout | null = null;
  tick = 0;
  sums: [number, number, number][] = [];

  send(message: ServerMessage): void {
    this.got.push(JSON.parse(JSON.stringify(message)) as ServerMessage);
    if (message.t === 'start') {
      const terrain = createTerrainState({ kind: 'map', id: message.map });
      this.layout = buildTerrain(terrain, maps);
      this.match = createMatch(terrain, this.layout, message.seed);
      this.tick = 0;
    } else if (message.t === 'ticks' && this.match && this.layout) {
      const inputs = new Map<number, MatchInput>(message.inputs);
      while (this.tick < message.upTo) {
        this.tick++;
        this.match = stepMatch(this.match, inputs.get(this.tick) ?? NO_INPUT, this.layout).state;
        if (message.sum && message.sum[0] === this.tick) {
          this.sums.push([this.tick, message.sum[1], matchChecksum(this.match)]);
        }
      }
    }
  }
}

function room(): Room {
  let n = 0;
  return new Room('ABCDE', maps, () => 1234 + n++);
}

describe('room', () => {
  it('seats two players and starts the match on the online map', () => {
    const r = room();
    const a = new FakeClient();
    const b = new FakeClient();
    expect(r.join(a)).toBe(0);
    expect(a.got).toContainEqual({ t: 'room', room: 'ABCDE', seat: 0 });
    expect(a.got.some((m) => m.t === 'start')).toBe(false);
    expect(r.join(b)).toBe(1);
    expect(a.got).toContainEqual({ t: 'start', map: 'glade', seed: 1234 });
    expect(b.got).toContainEqual({ t: 'start', map: 'glade', seed: 1234 });
    expect(r.join(new FakeClient())).toBeNull();
  });

  it('keeps both clients in step with the server, and only the active player moves', () => {
    const r = room();
    const a = new FakeClient();
    const b = new FakeClient();
    r.join(a);
    r.join(b);
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) r.step();
    };
    step(80); // past the intro
    const x0 = a.match?.snails[0]?.x ?? 0;
    // Red tries to move green's snail: ignored. Green crawls and shoots.
    r.onMessage(b, { t: 'input', input: { move: -1 } });
    r.onMessage(a, { t: 'input', input: { move: 1 } });
    step(30);
    r.onMessage(a, { t: 'input', input: { move: 0, fire: { x: 0.5, y: -0.6 } } });
    step(900);

    for (const c of [a, b]) {
      expect(c.sums.length).toBeGreaterThan(10);
      for (const [, server, client] of c.sums) expect(client).toBe(server);
    }
    expect(JSON.stringify(a.match)).toBe(JSON.stringify(b.match));
    expect(a.match?.snails[0]?.x).toBeGreaterThan(x0);
    expect(a.match?.turn).toBeGreaterThan(1);
  });

  it('sends the running state to a player who rejoins', () => {
    const r = room();
    const a = new FakeClient();
    const b = new FakeClient();
    r.join(a);
    r.join(b);
    for (let i = 0; i < 100; i++) r.step();
    r.leave(b);
    expect(a.got.at(-1)).toEqual({ t: 'peer', present: false });
    const c = new FakeClient();
    expect(r.join(c)).toBe(1);
    const state = c.got.find((m) => m.t === 'state');
    expect(state).toMatchObject({ t: 'state', tick: 100 });
  });
});
