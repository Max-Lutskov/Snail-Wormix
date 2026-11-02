/**
 * Pixel art for the terrain, following docs/art/ART_SPEC.md ("Сад і город").
 *
 * Buffers, all world-sized:
 * - base: the untouched ground look (soil tile, moss), painted once from the pre-crater terrain;
 * - burn: 0..255 scorch intensity around craters, accumulated with max();
 * - the visible texture = base blended toward the burn color, with anti-aliased edges, and
 *   transparent where there is no ground (holes show the sky and parallax behind).
 *
 * Decor (mushrooms, dew, grass) is not painted here: DecorView draws it as vector sprites.
 */

import { mossBumpLift } from '../../core/terrain/hills';
import type { TerrainLayout } from '../../core/terrain/layout';
import type { PixelRect, TerrainMask } from '../../core/terrain/mask';
import type { Crater } from '../../core/terrain/state';
import { hexToRgb, tokens, type Rgb } from '../art/tokens';

/** RGBA pixels, same layout as ImageData.data. */
export type Rgba = Uint8ClampedArray;

export interface SoilTile {
  readonly size: number;
  readonly pixels: Rgba;
}

const { terrain: T, colors: C } = tokens;
function mossBand(index: number): { from: number; to: number; rgb: Rgb } {
  const band = T.mossBands[index];
  if (!band) throw new Error(`tokens: terrain.mossBands[${index}] is missing`);
  return { from: band.from, to: band.to, rgb: hexToRgb(band.color) };
}
const HIGHLIGHT = mossBand(0);
const MAIN = mossBand(1);
const UNDER = mossBand(2);
const FUZZ_RGB = hexToRgb(C.moss.fuzz);
const WARM_RGB = hexToRgb(C.moss.warm);
const COOL_RGB = hexToRgb(C.moss.cool);
const BURN_RGB = hexToRgb(C.crater.burn);
/** Depth (px below the surface) at which soil reaches its darkest shade. */
const DARKEST_DEPTH = 420;
/** Half-width of the window used to smooth the surface before measuring its slope. */
const SLOPE_SMOOTH = 12;

/** Cheap stable integer hash → [0, 1) (render-only). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function put(out: Rgba, o: number, rgb: Rgb, k = 1): void {
  out[o] = rgb[0] * k;
  out[o + 1] = rgb[1] * k;
  out[o + 2] = rgb[2] * k;
  out[o + 3] = 255;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Large, slow variation along the surface in [-1, 1] (period ~120–200 px): two incommensurate
 * waves so the pattern never visibly repeats.
 */
function mossVariation(x: number): number {
  const { periodMin, periodMax } = T.mossVariation;
  return (
    0.6 * Math.sin((x / periodMax) * Math.PI * 2 + 1.3) +
    0.4 * Math.sin((x / periodMin) * Math.PI * 2 + 4.1)
  );
}

/** Applies the surface variation: brightness ± and a shift toward warm (+) or cool (−) green. */
function varyMoss(rgb: Rgb, v: number): Rgb {
  const shifted = mix(rgb, v > 0 ? WARM_RGB : COOL_RGB, Math.abs(v) * T.mossVariation.hueShift);
  const k = 1 + T.mossVariation.brightness * v;
  return [shifted[0] * k, shifted[1] * k, shifted[2] * k];
}

/**
 * Soil from the 80×80 tile, using one of its 8 flips/rotations per tile-sized block so the
 * grid disappears without cutting details at block seams (the tile keeps details off its edges).
 */
function soilTexel(tile: SoilTile, x: number, y: number): number {
  const n = tile.size;
  const variant = Math.floor(hash2(Math.floor(x / n), Math.floor(y / n) + 7919) * 8);
  let u = x % n;
  let v = y % n;
  if (variant & 1) u = n - 1 - u;
  if (variant & 2) v = n - 1 - v;
  if (variant & 4) [u, v] = [v, u];
  return (v * n + u) * 4;
}

/** 1 for every mask pixel that belongs to decor rather than ground. */
export function decorOwnership(layout: TerrainLayout): Uint8Array {
  const owned = new Uint8Array(layout.mask.width * layout.mask.height);
  for (const pixels of layout.decorPixels) for (const p of pixels) owned[p] = 1;
  return owned;
}

/** Ground art for generated terrain: varied soil tile with moss along the surface. */
export function paintGardenArt(layout: TerrainLayout, tile: SoilTile): Rgba {
  const { width, height, data } = layout.mask;
  const out = new Uint8ClampedArray(width * height * 4);
  const owned = decorOwnership(layout);
  const { lift, owner } = mossBumpLift(width, layout.mossBumps);

  // First ground pixel per column, ignoring decor.
  const top = new Int32Array(width).fill(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      if (data[i] === 1 && owned[i] === 0) {
        top[x] = y;
        break;
      }
    }
  }

  // Moss bands are measured along the surface normal: thicken them on slopes by 1/cos(slope).
  const base = new Float64Array(width);
  for (let x = 0; x < width; x++) base[x] = (top[x] ?? height) + (lift[x] ?? 0);
  const prefix = new Float64Array(width + 1);
  for (let x = 0; x < width; x++) prefix[x + 1] = (prefix[x] ?? 0) + (base[x] ?? 0);
  const smooth = (x: number): number => {
    const a = Math.max(0, x - SLOPE_SMOOTH);
    const b = Math.min(width, x + SLOPE_SMOOTH + 1);
    return ((prefix[b] ?? 0) - (prefix[a] ?? 0)) / (b - a);
  };

  const soilShadeRange = 1 - T.depthDarkenMin;
  const grainAmount = T.soilGrain;

  for (let x = 0; x < width; x++) {
    const colTop = top[x] ?? height;
    const baseline = colTop + (lift[x] ?? 0);
    const slope = (smooth(Math.min(width - 1, x + 6)) - smooth(Math.max(0, x - 6))) / 12;
    const stretch = Math.min(T.mossBandMaxStretch, Math.sqrt(1 + slope * slope));
    const highlightEnd = HIGHLIGHT.to * stretch;
    const mainEnd = MAIN.to * stretch;
    const underEnd = UNDER.to * stretch;
    const variation = mossVariation(x);
    const bump = owner[x] ?? -1;
    const bumpJitter = 1 + (hash2(bump, 31) * 2 - 1) * T.mossFuzz.colorJitter;

    for (let y = colTop; y < height; y++) {
      const i = y * width + x;
      if (data[i] === 0) continue;
      const o = i * 4;
      const fromTop = y - colTop;
      const fromBase = y - baseline;

      if (fromTop < highlightEnd) {
        put(out, o, varyMoss(HIGHLIGHT.rgb, variation)); // crisp: no grain
      } else if (fromBase < 0) {
        put(out, o, varyMoss(FUZZ_RGB, variation), bumpJitter);
      } else if (fromBase < mainEnd - HIGHLIGHT.to) {
        put(out, o, varyMoss(MAIN.rgb, variation), 0.97 + hash2(x, y) * 0.06);
      } else if (fromBase < underEnd - HIGHLIGHT.to) {
        put(out, o, UNDER.rgb); // crisp shadow line between moss and soil
      } else {
        const t = soilTexel(tile, x, y);
        const depth = Math.max(0, fromBase);
        const k =
          (1 - soilShadeRange * Math.min(1, depth / DARKEST_DEPTH)) *
          (1 - grainAmount + hash2(x, y) * 2 * grainAmount);
        out[o] = (tile.pixels[t] ?? 0) * k;
        out[o + 1] = (tile.pixels[t + 1] ?? 0) * k;
        out[o + 2] = (tile.pixels[t + 2] ?? 0) * k;
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Pixel rect a crater's scorch can touch (crater plus the burn ring), clipped to the world. */
export function burnBounds(mask: TerrainMask, c: Crater): PixelRect {
  const reach = c.r + T.burnRadius + 1;
  const x0 = Math.max(0, Math.floor(c.x - reach));
  const y0 = Math.max(0, Math.floor(c.y - reach));
  const x1 = Math.min(mask.width, Math.ceil(c.x + reach));
  const y1 = Math.min(mask.height, Math.ceil(c.y + reach));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/**
 * Adds a crater's scorch ring: full strength right at the cut, fading to nothing at
 * `burnRadius` px. Max-combined so overlapping craters don't over-darken.
 */
export function addBurn(burn: Uint8Array, mask: TerrainMask, c: Crater): void {
  const rect = burnBounds(mask, c);
  const ring = T.burnRadius;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const dy = y + 0.5 - c.y;
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const dx = x + 0.5 - c.x;
      const d = Math.sqrt(dx * dx + dy * dy) - c.r;
      if (d <= 0 || d > ring) continue;
      const t = 1 - (d - 1) / (ring - 1);
      const v = Math.round(255 * Math.min(1, Math.max(0, t)) * (0.85 + hash2(x, y) * 0.15));
      const i = y * mask.width + x;
      if (v > (burn[i] ?? 0)) burn[i] = v;
    }
  }
}

/** Neighbour order when an edge pixel borrows a ground color: sides first, then corners. */
const NEIGHBOURS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

/**
 * Writes the visible terrain for `rect` into `target`.
 *
 * Ground = mask pixels not owned by decor. Edges are anti-aliased by coverage: alpha is the
 * share of ground in the pixel's 3×3 neighbourhood (a straight edge gets ~2/3 inside and ~1/3
 * on the outer air pixel), and air pixels borrow a neighbouring ground color. The mask itself
 * stays binary; only the picture's edge is soft (as the terrain spec allows).
 */
export function composeTerrain(
  target: Rgba,
  base: Rgba,
  burn: Uint8Array,
  mask: TerrainMask,
  owned: Uint8Array,
  rect: PixelRect,
): void {
  const { width, height, data } = mask;
  // Ground flags for the rect plus a 1 px border (0 outside the world), so the 3×3 sums below
  // are plain index reads with no bounds checks.
  const gw = rect.width + 2;
  const gh = rect.height + 2;
  const g = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y = rect.y + gy - 1;
    if (y < 0 || y >= height) continue;
    for (let gx = 0; gx < gw; gx++) {
      const x = rect.x + gx - 1;
      if (x < 0 || x >= width) continue;
      const i = y * width + x;
      g[gy * gw + gx] = data[i] === 1 && owned[i] === 0 ? 1 : 0;
    }
  }
  const writeColor = (o: number, i: number): void => {
    const k = (burn[i] ?? 0) / 255;
    const bo = i * 4;
    target[o] = (base[bo] ?? 0) + (BURN_RGB[0] - (base[bo] ?? 0)) * k;
    target[o + 1] = (base[bo + 1] ?? 0) + (BURN_RGB[1] - (base[bo + 1] ?? 0)) * k;
    target[o + 2] = (base[bo + 2] ?? 0) + (BURN_RGB[2] - (base[bo + 2] ?? 0)) * k;
  };

  for (let gy = 1; gy <= rect.height; gy++) {
    const y = rect.y + gy - 1;
    const up = (gy - 1) * gw;
    const mid = gy * gw;
    const down = (gy + 1) * gw;
    for (let gx = 1; gx <= rect.width; gx++) {
      const x = rect.x + gx - 1;
      const i = y * width + x;
      const o = i * 4;
      const n =
        (g[up + gx - 1] ?? 0) +
        (g[up + gx] ?? 0) +
        (g[up + gx + 1] ?? 0) +
        (g[mid + gx - 1] ?? 0) +
        (g[mid + gx] ?? 0) +
        (g[mid + gx + 1] ?? 0) +
        (g[down + gx - 1] ?? 0) +
        (g[down + gx] ?? 0) +
        (g[down + gx + 1] ?? 0);
      if (n === 0) {
        target[o + 3] = 0;
        continue;
      }
      if (g[mid + gx] === 1) {
        writeColor(o, i);
      } else {
        // Air pixel on the edge: borrow the color of a neighbouring ground pixel.
        const from = NEIGHBOURS.find(([dx, dy]) => g[(gy + dy) * gw + gx + dx] === 1);
        if (!from) continue; // unreachable: n > 0 means a neighbour is ground
        writeColor(o, (y + from[1]) * width + (x + from[0]));
      }
      target[o + 3] = Math.round((255 * n) / 9);
    }
  }
}
