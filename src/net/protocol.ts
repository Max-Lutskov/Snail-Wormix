/**
 * Messages between the game client and the room server (JSON over a WebSocket on /ws).
 *
 * The server is the source of truth: it runs the match (src/core) at 60 ticks per second
 * with the inputs it accepts from the player whose turn it is, and sends every client the
 * input of each tick. Clients step the same core with those inputs, so they show the same
 * match; a checksum every second catches a drift, and the client then asks for the state.
 */

import type { MatchInput, MatchState } from '../core/match';

/** Inputs sent by a client: crawl state plus one-shot actions. */
export type ClientInput = Partial<Omit<MatchInput, 'move'>> & {
  readonly move?: MatchInput['move'];
};

export type ClientMessage =
  | { readonly t: 'create' }
  | { readonly t: 'join'; readonly room: string }
  | { readonly t: 'input'; readonly input: ClientInput }
  | { readonly t: 'resync' }
  | { readonly t: 'rematch' };

export type ServerMessage =
  /** You are in `room` on `seat` (= your team); waiting for the other player if alone. */
  | { readonly t: 'room'; readonly room: string; readonly seat: number }
  /** A new match on a drawn map, with the seed every client must use. */
  | { readonly t: 'start'; readonly map: string; readonly seed: number }
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
  | { readonly t: 'error'; readonly message: string };

/** Ticks per second, and how many ticks the server batches into one message. */
export const NET_TICK_RATE = 60;
export const NET_BATCH = 1;
/** The server sends a checksum every this many ticks. */
export const NET_CHECKSUM_EVERY = 60;
/** The map online matches are played on (drawn maps load the same everywhere). */
export const NET_MAP = 'glade';
