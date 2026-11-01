/**
 * Seeded, deterministic RNG (mulberry32).
 *
 * The state is a plain uint32 so it can live inside the serialized game state:
 * same seed + same calls → same numbers on every client, the server and in replays.
 * Never use Math.random() in core.
 */

export type RngState = number;

export interface RngResult {
  readonly value: number;
  readonly state: RngState;
}

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** Returns a float in [0, 1) and the next state. */
export function nextFloat(state: RngState): RngResult {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: next };
}

/** Returns an integer in [min, max] (inclusive) and the next state. */
export function nextInt(state: RngState, min: number, max: number): RngResult {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError(`nextInt: invalid range [${min}, ${max}]`);
  }
  const { value, state: next } = nextFloat(state);
  return { value: min + Math.floor(value * (max - min + 1)), state: next };
}
