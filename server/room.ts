/**
 * One online match between two players: seats, the authoritative match and its tick loop.
 * No sockets here (see main.ts), so it can be driven from tests.
 */

import {
  createMatch,
  matchChecksum,
  NO_INPUT,
  stepMatch,
  type MatchInput,
  type MatchState,
} from '../src/core/match';
import type { TerrainLayout } from '../src/core/terrain/layout';
import type { MapLookup } from '../src/core/terrain/map';
import { buildTerrain, createTerrainState } from '../src/core/terrain/state';
import { WEAPON_IDS } from '../src/core/weapons';
import {
  NET_BATCH,
  NET_CHECKSUM_EVERY,
  NET_MAP,
  type ClientInput,
  type ClientMessage,
  type ServerMessage,
} from '../src/net/protocol';

export interface Peer {
  send(message: ServerMessage): void;
}

const SEATS = 2;

function isIdle(input: MatchInput): boolean {
  return (
    input.move === 0 && !input.jump && input.fire === null && input.weapon === null && !input.hide
  );
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export class Room {
  readonly seats: (Peer | null)[] = Array.from({ length: SEATS }, () => null);
  private match: MatchState | null = null;
  private layout: TerrainLayout | null = null;
  private tick = 0;
  /** The active player's held crawl direction and one-shot actions waiting for a tick. */
  private move: MatchInput['move'] = 0;
  private pending: Omit<MatchInput, 'move'> = { ...NO_INPUT };
  private outbox: [number, MatchInput][] = [];
  /** Whose turn the held input belongs to: reset when the turn changes. */
  private inputTeam = -1;

  constructor(
    readonly id: string,
    private readonly maps: MapLookup,
    private readonly seed: () => number,
  ) {}

  get empty(): boolean {
    return this.seats.every((s) => s === null);
  }

  /** Seats the peer in the first free seat; null when the room is full. */
  join(peer: Peer): number | null {
    const seat = this.seats.indexOf(null);
    if (seat < 0) return null;
    this.seats[seat] = peer;
    peer.send({ t: 'room', room: this.id, seat });
    this.broadcast({ t: 'peer', present: true }, peer);
    if (this.match) {
      peer.send({ t: 'state', tick: this.tick, state: this.match });
    } else if (this.seats.every((s) => s !== null)) {
      this.start();
    }
    return seat;
  }

  leave(peer: Peer): void {
    const seat = this.seats.indexOf(peer);
    if (seat < 0) return;
    this.seats[seat] = null;
    this.broadcast({ t: 'peer', present: false });
  }

  onMessage(peer: Peer, message: ClientMessage): void {
    const seat = this.seats.indexOf(peer);
    if (seat < 0) return;
    switch (message.t) {
      case 'input':
        this.input(seat, message.input);
        break;
      case 'resync':
        if (this.match) peer.send({ t: 'state', tick: this.tick, state: this.match });
        break;
      case 'rematch':
        if (this.match?.phase === 'over') this.start();
        break;
      default:
        break;
    }
  }

  /** Advances the match by one tick (60 per second, driven by main.ts). */
  step(): void {
    const match = this.match;
    const layout = this.layout;
    if (!match || !layout || match.phase === 'over') return;
    const team = match.snails[match.active]?.team ?? -1;
    if (team !== this.inputTeam) {
      this.inputTeam = team;
      this.move = 0;
      this.pending = { ...NO_INPUT };
    }
    const input: MatchInput = { ...this.pending, move: this.move };
    this.pending = { ...NO_INPUT };
    this.match = stepMatch(match, input, layout).state;
    this.tick++;
    if (!isIdle(input)) this.outbox.push([this.tick, input]);
    const sum = this.tick % NET_CHECKSUM_EVERY === 0;
    if (this.tick % NET_BATCH === 0 || sum || this.match.phase === 'over') {
      this.broadcast({
        t: 'ticks',
        upTo: this.tick,
        inputs: this.outbox,
        ...(sum ? { sum: [this.tick, matchChecksum(this.match)] as const } : {}),
      });
      this.outbox = [];
    }
  }

  private start(): void {
    const map = this.maps(NET_MAP);
    if (!map) {
      this.broadcast({ t: 'error', message: `map ${NET_MAP} is not available` });
      return;
    }
    const seed = this.seed();
    const terrain = createTerrainState({ kind: 'map', id: NET_MAP });
    this.layout = buildTerrain(terrain, this.maps);
    this.match = createMatch(terrain, this.layout, seed);
    this.tick = 0;
    this.move = 0;
    this.pending = { ...NO_INPUT };
    this.outbox = [];
    this.inputTeam = -1;
    this.broadcast({ t: 'start', map: NET_MAP, seed });
  }

  /** Takes input only from the player whose turn it is; validates its shape. */
  private input(seat: number, input: ClientInput): void {
    const match = this.match;
    if (!match || match.snails[match.active]?.team !== seat) return;
    if (input.move === -1 || input.move === 0 || input.move === 1) this.move = input.move;
    const fire =
      input.fire && finite(input.fire.x) && finite(input.fire.y)
        ? { x: input.fire.x, y: input.fire.y }
        : this.pending.fire;
    const weapon =
      input.weapon && WEAPON_IDS.includes(input.weapon) ? input.weapon : this.pending.weapon;
    this.pending = {
      jump: this.pending.jump || input.jump === true,
      fire,
      weapon,
      hide: this.pending.hide || input.hide === true,
    };
  }

  private broadcast(message: ServerMessage, except?: Peer): void {
    for (const s of this.seats) if (s && s !== except) s.send(message);
  }
}
