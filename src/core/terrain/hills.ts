/**
 * Procedural hills from a seed: 1D value noise over columns, with flat spawn pads.
 *
 * Only exact arithmetic (+ - * /, floor) and the seeded RNG are used: Math.sin/cos/pow
 * may differ between JS engines and would make clients, server and replays disagree.
 */

import { nextFloat, seedRng, type RngState } from '../rng';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../world';
import type { TerrainLayout } from './layout';
import { createMask, fillBelow } from './mask';

export const HILLS_LIMITS = {
  /** Water surface, measured up from the bottom of the world. */
  waterDepth: 50,
  /** Highest allowed surface (smallest y). */
  minSurfaceY: 200,
  /** Lowest allowed surface stays this far above the water. */
  minLandAboveWater: 60,
  /** Spawn pads are flat for this many pixels either side of the spawn x. */
  spawnFlatHalfWidth: 30,
  /** Width of the smooth ramp from a pad back into the hills. */
  spawnRampWidth: 50,
} as const;

/** Average surface height as a fraction of world height. */
const BASE_LEVEL = 0.58;
/** Peak deviation from the base level, in pixels. */
const AMPLITUDE = 170;
/** Octaves: wavelength in pixels and relative weight. */
const OCTAVES = [
  { wavelength: 480, weight: 1 },
  { wavelength: 240, weight: 0.5 },
  { wavelength: 120, weight: 0.25 },
  { wavelength: 60, weight: 0.12 },
] as const;
/** Spawns at these fractions of the world width. */
const SPAWN_FRACTIONS = [0.2, 0.8] as const;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Adds one octave of value noise (values in [-weight, weight]) to `out`. */
function addOctave(out: Float64Array, rng: RngState, wavelength: number, weight: number): RngState {
  const points = Math.floor(out.length / wavelength) + 2;
  const lattice = new Float64Array(points);
  let state = rng;
  for (let i = 0; i < points; i++) {
    const r = nextFloat(state);
    lattice[i] = r.value * 2 - 1;
    state = r.state;
  }
  for (let x = 0; x < out.length; x++) {
    const i = Math.floor(x / wavelength);
    const t = smoothstep((x - i * wavelength) / wavelength);
    const a = lattice[i] ?? 0;
    const b = lattice[i + 1] ?? 0;
    out[x] = (out[x] ?? 0) + (a + (b - a) * t) * weight;
  }
  return state;
}

function flattenPad(surface: Float64Array, cx: number): void {
  const { spawnFlatHalfWidth: flat, spawnRampWidth: ramp } = HILLS_LIMITS;
  const level = surface[cx] ?? 0;
  const from = Math.max(0, cx - flat - ramp);
  const to = Math.min(surface.length - 1, cx + flat + ramp);
  for (let x = from; x <= to; x++) {
    const d = x < cx ? cx - x : x - cx;
    const current = surface[x] ?? level;
    if (d <= flat) {
      surface[x] = level;
    } else {
      const t = smoothstep((d - flat) / ramp);
      surface[x] = level + (current - level) * t;
    }
  }
}

export function generateHills(
  seed: number,
  width: number = WORLD_WIDTH,
  height: number = WORLD_HEIGHT,
): TerrainLayout {
  const waterLevel = height - HILLS_LIMITS.waterDepth;
  const lowest = waterLevel - HILLS_LIMITS.minLandAboveWater;
  const highest = HILLS_LIMITS.minSurfaceY;

  const noise = new Float64Array(width);
  let rng = seedRng(seed);
  let totalWeight = 0;
  for (const { wavelength, weight } of OCTAVES) {
    rng = addOctave(noise, rng, wavelength, weight);
    totalWeight += weight;
  }

  const base = height * BASE_LEVEL;
  const surface = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const y = base + ((noise[x] ?? 0) / totalWeight) * AMPLITUDE;
    surface[x] = Math.min(lowest, Math.max(highest, y));
  }

  const spawns = SPAWN_FRACTIONS.map((f) => ({ x: Math.floor(width * f) }));
  for (const { x } of spawns) flattenPad(surface, x);

  const columns = new Int32Array(width);
  for (let x = 0; x < width; x++) columns[x] = Math.floor(surface[x] ?? lowest);

  const mask = createMask(width, height);
  fillBelow(mask, columns);
  return { mask, waterLevel, spawns };
}
