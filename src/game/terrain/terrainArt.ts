import type { PixelRect, TerrainMask } from '../../core/terrain/mask';

/** RGBA pixels, same layout as ImageData.data. */
export type Rgba = Uint8ClampedArray;

const GRASS_DEPTH = 6;
const BURN_RADIUS = 3;
const DIRT = [122, 82, 54] as const;
const GRASS_TOP = [126, 186, 74] as const;
const GRASS_BOTTOM = [78, 140, 52] as const;
const BURN = [58, 38, 28] as const;

/** Cheap stable per-pixel hash in [0, 1) for texture grain (render-only). */
function grain(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function put(out: Rgba, i: number, r: number, g: number, b: number): void {
  out[i] = r;
  out[i + 1] = g;
  out[i + 2] = b;
  out[i + 3] = 255;
}

/**
 * Generated art for terrain without its own picture (procedural hills):
 * grass along the original surface, grainy dirt that darkens with depth.
 */
export function paintHillsArt(mask: TerrainMask): Rgba {
  const { width, height, data } = mask;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let x = 0; x < width; x++) {
    let depth = -1; // pixels since the last air pixel above
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      if (data[i] === 0) {
        depth = -1;
        continue;
      }
      depth++;
      const n = grain(x, y);
      if (depth < GRASS_DEPTH) {
        const t = depth / GRASS_DEPTH;
        const k = 0.92 + n * 0.16;
        put(
          out,
          i * 4,
          (GRASS_TOP[0] + (GRASS_BOTTOM[0] - GRASS_TOP[0]) * t) * k,
          (GRASS_TOP[1] + (GRASS_BOTTOM[1] - GRASS_TOP[1]) * t) * k,
          (GRASS_TOP[2] + (GRASS_BOTTOM[2] - GRASS_TOP[2]) * t) * k,
        );
      } else {
        const shade = Math.max(0.55, 1 - depth / 900) * (0.88 + n * 0.24);
        put(out, i * 4, DIRT[0] * shade, DIRT[1] * shade, DIRT[2] * shade);
      }
    }
  }
  return out;
}

/** True if a pixel near (x, y) used to be ground and is now air, i.e. a crater edge. */
function nearCarved(original: TerrainMask, live: TerrainMask, x: number, y: number): boolean {
  const { width, height } = live;
  for (let d = 1; d <= BURN_RADIUS; d++) {
    const probes = [
      [x - d, y],
      [x + d, y],
      [x, y - d],
      [x, y + d],
    ] as const;
    for (const [px, py] of probes) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = py * width + px;
      if (live.data[i] === 0 && original.data[i] === 1) return true;
    }
  }
  return false;
}

/**
 * Writes the visible terrain for `rect` into `target`: base art where the live mask is
 * ground, transparent where it is air, and a burnt rim along crater edges.
 */
export function composeTerrain(
  target: Rgba,
  base: Rgba,
  original: TerrainMask,
  live: TerrainMask,
  rect: PixelRect,
): void {
  const { width } = live;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = y * width + x;
      const o = i * 4;
      if (live.data[i] === 0) {
        target[o + 3] = 0;
        continue;
      }
      if (nearCarved(original, live, x, y)) {
        const k = 0.85 + grain(x, y) * 0.3;
        put(target, o, BURN[0] * k, BURN[1] * k, BURN[2] * k);
        continue;
      }
      target[o] = base[o] ?? 0;
      target[o + 1] = base[o + 1] ?? 0;
      target[o + 2] = base[o + 2] ?? 0;
      target[o + 3] = 255;
    }
  }
}
