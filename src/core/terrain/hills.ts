/**
 * Procedural hills from a seed: 1D value noise over columns, with flat spawn pads,
 * a fluffy moss edge and surface decor.
 *
 * Only exact arithmetic (+ - * /, floor, sqrt) and the seeded RNG are used: Math.sin/cos/pow
 * may differ between JS engines and would make clients, server and replays disagree.
 */

import { nextFloat, seedRng, type RngState } from '../rng';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../world';
import { stampDecor, type Decor, type GrassBlade } from './decor';
import type { MossBump, TerrainLayout } from './layout';
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

/**
 * Fluffy moss edge (art spec): sparse, uneven bumps. The ground top is lowered by `heightMax`
 * and each bump raises it back by its own height, so bumps never rise above the hill line.
 * Mirrored in docs/art/tokens.json (terrain.mossFuzz); these values shape the mask.
 */
export const MOSS_FUZZ = {
  diameterMin: 8,
  diameterMax: 14,
  spacingMin: 12,
  spacingMax: 22,
  skipChance: 0.2,
  heightMin: 3,
  heightMax: 6,
} as const;

/** Surface decor counts and sizes (art spec). Mirrored in docs/art/tokens.json (decor). */
export const DECOR = {
  mushrooms: { countMin: 4, countMax: 5, pairChance: 0.45, bigScale: 1.35, smallScale: 0.8 },
  dew: { countMin: 3, countMax: 6, radii: [3.5, 4] },
  grass: { stepMin: 60, stepMax: 120, bladesMin: 2, bladesMax: 3, heightMin: 5, heightMax: 8 },
  /** Decor keeps this far (px) from spawn x so snails land on clean ground. */
  spawnClearance: 70,
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

  const r = new Rand(rng);
  const mossBumps = placeMossBumps(width, r);
  const { lift } = mossBumpLift(width, mossBumps);
  const columns = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    columns[x] = Math.floor(surface[x] ?? lowest) + MOSS_FUZZ.heightMax - (lift[x] ?? 0);
  }

  const mask = createMask(width, height);
  fillBelow(mask, columns);

  const decor = placeDecor(columns, spawns, r);
  for (const d of decor) stampDecor(mask, d);

  return { mask, waterLevel, spawns, decor, mossBumps };
}

/** Sequential wrapper over the pure RNG, to keep placement code readable. */
class Rand {
  constructor(private state: RngState) {}

  float(): number {
    const r = nextFloat(this.state);
    this.state = r.state;
    return r.value;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.float() * items.length)];
    if (item === undefined) throw new Error('Rand.pick: empty list');
    return item;
  }
}

function placeMossBumps(width: number, r: Rand): MossBump[] {
  const f = MOSS_FUZZ;
  const out: MossBump[] = [];
  for (let x = r.int(0, f.spacingMax); x < width; x += r.int(f.spacingMin, f.spacingMax)) {
    if (r.float() < f.skipChance) continue;
    out.push({
      x,
      diameter: r.int(f.diameterMin, f.diameterMax),
      height: r.int(f.heightMin, f.heightMax),
    });
  }
  return out;
}

/**
 * Per column, how much the bumps raise the scalloped base line (max over overlapping bumps),
 * and which bump that is (-1 for none). Exported so the renderer colors exactly these pixels.
 */
export function mossBumpLift(
  width: number,
  bumps: readonly MossBump[],
): { lift: Int32Array; owner: Int32Array } {
  const lift = new Int32Array(width);
  const owner = new Int32Array(width).fill(-1);
  bumps.forEach((b, index) => {
    const half = b.diameter / 2;
    const from = Math.max(0, Math.floor(b.x - half));
    const to = Math.min(width - 1, Math.floor(b.x + half));
    for (let x = from; x <= to; x++) {
      const t = (x - b.x) / half;
      if (t * t >= 1) continue;
      const h = Math.floor(b.height * Math.sqrt(1 - t * t) + 0.5);
      if (h > (lift[x] ?? 0)) {
        lift[x] = h;
        owner[x] = index;
      }
    }
  });
  return { lift, owner };
}

/** Deepest ground (largest y) over columns [x - half, x + half]. */
function groundUnder(columns: Int32Array, x: number, half: number): number {
  let ground = 0;
  for (let dx = -half; dx <= half; dx++) ground = Math.max(ground, columns[x + dx] ?? 0);
  return ground;
}

function placeDecor(columns: Int32Array, spawns: readonly { x: number }[], r: Rand): Decor[] {
  const width = columns.length;
  const out: Decor[] = [];
  const nearSpawn = (x: number, extra = 0): boolean =>
    spawns.some((s) => Math.abs(s.x - x) <= DECOR.spawnClearance + extra);
  const nearDecor = (x: number, gap: number): boolean => out.some((d) => Math.abs(d.x - x) < gap);

  // Mushrooms: one spot per equal segment of the map; some spots are a big+small pair.
  const M = DECOR.mushrooms;
  const spots = r.int(M.countMin, M.countMax);
  const segment = width / spots;
  for (let i = 0; i < spots; i++) {
    const from = segment * i;
    let x = Math.floor(from + segment * (0.15 + 0.7 * r.float()));
    const pair = r.float() < M.pairChance;
    const side = r.float() < 0.5 ? -1 : 1;
    const offset = r.int(17, 21);
    // Too close to a spawn: slide out of its keep-out zone, staying inside this segment.
    const clearance = DECOR.spawnClearance + 31;
    const blocker = spawns.find((s) => Math.abs(s.x - x) <= clearance);
    if (blocker) {
      const options = [blocker.x - clearance - 1, blocker.x + clearance + 1].filter(
        (c) => c >= from + 20 && c <= from + segment - 20 && !nearSpawn(c, 30),
      );
      const moved = options[0];
      if (moved === undefined) continue;
      x = moved;
    }
    if (x < 30 || x > width - 30) continue;
    const scale = pair ? M.bigScale : 1;
    out.push({ kind: 'mushroom', x, y: groundUnder(columns, x, Math.ceil(3 * scale)) + 1, scale });
    if (pair) {
      const sx = x + side * offset;
      out.push({
        kind: 'mushroom',
        x: sx,
        y: groundUnder(columns, sx, 3) + 1,
        scale: M.smallScale,
      });
    }
  }

  // Dew drops resting on the moss.
  const D = DECOR.dew;
  const drops = r.int(D.countMin, D.countMax);
  for (let placed = 0, tries = 0; placed < drops && tries < drops * 8; tries++) {
    const x = r.int(30, width - 30);
    const radius = r.pick(D.radii);
    if (nearSpawn(x) || nearDecor(x, 24)) continue;
    const top = Math.min(columns[x - 1] ?? 0, columns[x] ?? 0, columns[x + 1] ?? 0);
    out.push({ kind: 'dew', x: x + 0.5, y: top - radius + 1.5, r: radius });
    placed++;
  }

  // Sparse grass tufts.
  const G = DECOR.grass;
  for (let x = r.int(20, G.stepMax); x < width - 20; x += r.int(G.stepMin, G.stepMax)) {
    const count = r.int(G.bladesMin, G.bladesMax);
    const blades: GrassBlade[] = [];
    for (let k = 0; k < count; k++) {
      const dx = r.int(-3, 3);
      blades.push({
        dx,
        y: (columns[x + dx] ?? 0) + 1,
        height: r.int(G.heightMin, G.heightMax),
        lean: r.int(-2, 2),
      });
    }
    if (nearSpawn(x, -30) || nearDecor(x, 16)) continue;
    out.push({ kind: 'grass', x, blades });
  }

  return out;
}
