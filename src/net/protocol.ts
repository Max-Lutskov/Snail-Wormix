/**
 * Messages between the game client and the room server (JSON over a WebSocket on /ws).
 *
 * The server is the source of truth: it runs the match (src/core) at 60 ticks per second
 * with the inputs it accepts from the player whose turn it is, and sends every client the
 * input of each tick. Clients step the same core with those inputs, so they show the same
 * match; a checksum every second catches a drift, and the client then asks for the state.
 */

import type { MatchInput, MatchState } from '../core/match';
import type { TerrainSource } from '../core/terrain/state';

/** Inputs sent by a client: crawl state plus one-shot actions. */
export type ClientInput = Partial<Omit<MatchInput, 'move'>> & {
  readonly move?: MatchInput['move'];
};

export type ClientMessage =
  /** Creates a room for a match on `source` (a drawn map). */
  | { readonly t: 'create'; readonly source: TerrainSource }
  | { readonly t: 'join'; readonly room: string }
  | { readonly t: 'input'; readonly input: ClientInput }
  | { readonly t: 'resync' }
  /** Round-trip probe: the server echoes `at` back in a pong. */
  | { readonly t: 'ping'; readonly at: number }
  | { readonly t: 'rematch' };

export type ServerMessage =
  /** You are in `room` on `seat` (= your team); waiting for the other player if alone. */
  | { readonly t: 'room'; readonly room: string; readonly seat: number }
  /** A new match on `source`, with the seed every client must use. */
  | { readonly t: 'start'; readonly source: TerrainSource; readonly seed: number }
  /** The full state at tick `tick` (on joining a running match, or after a resync). */
  | { readonly t: 'state'; readonly tick: number; readonly state: MatchState }
  /**
   * Ticks up to and including `upTo`: `inputs` lists the ticks with input (others are idle);
   * `sum` is the checksum of the state after tick sum[0].
   */
  | {
      readonly t: 'ticks';
      readonly upTo: number;
      readonly inputs: readonly (readonly [number, MatchInput])[];
      readonly sum?: readonly [number, number];
    }
  | { readonly t: 'peer'; readonly present: boolean }
  | { readonly t: 'pong'; readonly at: number }
  | { readonly t: 'error'; readonly message: string };

/** Ticks per second, and how many ticks the server batches into one message. */
export const NET_TICK_RATE = 60;
export const NET_BATCH = 1;
/** The server sends a checksum every this many ticks. */
export const NET_CHECKSUM_EVERY = 60;
/** Whether a client-sent terrain source can be played: a drawn map the server has. */
export function validSource(source: unknown, hasMap: (id: string) => boolean): boolean {
  if (typeof source !== 'object' || source === null) return false;
  const s = source as Record<string, unknown>;
  return s['kind'] === 'map' && typeof s['id'] === 'string' && hasMap(s['id']);
}
