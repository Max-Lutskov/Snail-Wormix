/**
 * Pixel art for the terrain, following docs/art/ART_SPEC.md ("Сад і город").
 *
 * The art is ART_SCALE px per world unit; the mask (physics) stays 1 px per unit. Buffers:
 * - base (art-sized): the untouched ground look (soil tile, moss), painted once from the
 *   pre-crater terrain, or a drawn map's PNG;
 * - burn (world-sized): 0..255 scorch intensity around craters, accumulated with max();
 * - edge field (world-sized, see edgeField.ts): signed distance to the ground/air boundary.
 * The visible texture = base, lightened along fresh cuts, faintly scorched, with a dark contour
 * along the boundary and anti-aliased edges; transparent where there is no ground.
 *
 * Decor (mushrooms, dew, grass) is not painted here: DecorView draws it as vector sprites.
 */

import { mossBumpLift } from '../../core/terrain/hills';
import type { TerrainLayout } from '../../core/terrain/layout';
import type { PixelRect, TerrainMask } from '../../core/terrain/mask';
import type { Crater } from '../../core/terrain/state';
import { ART_SCALE } from '../../core/world';
import { hexToRgb, tokens, type Rgb } from '../art/tokens';
import type { EdgeField } from './edgeField';

/** RGBA pixels, same layout as ImageData.data. */
export type Rgba = Uint8ClampedArray;

export interface SoilTile {
  /** Side in art px. */
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
const OUTLINE_RGB = hexToRgb(T.outline.color);
/** Contour and fresh-cut lip widths, world px. */
const OUTLINE = T.outline.width;
const LIP = T.freshCut.width;
/** Depth (px below the surface) at which soil reaches its darkest shade. */
const DARKEST_DEPTH = 420;
/** Half-width of the window used to smooth the surface before measuring its slope. */
const SLOPE_SMOOTH = 12;
/** Surface step (world px) between neighbouring columns above which it is a cliff, not a slope. */
const CLIFF = 3;

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
 * Soil from the tile (art px), using one of its 8 flips/rotations per tile-sized block so the
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

/**
 * Ground art for generated terrain, art-sized: varied soil tile with moss along the surface.
 * Moss bands start under the contour, which covers the first `outline.width` px.
 */
export function paintGardenArt(layout: TerrainLayout, tile: SoilTile): Rgba {
  const { width, height, data } = layout.mask;
  const artWidth = width * ART_SCALE;
  const out = new Uint8ClampedArray(artWidth * height * ART_SCALE * 4);
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

  // Surface height at art column u, interpolated between world columns so band edges slope
  // smoothly instead of stepping every world px (but not across cliffs).
  const surfaceAt = (values: ArrayLike<number>, u: number): number => {
    const wx = (u + 0.5) / ART_SCALE - 0.5;
    const x0 = Math.max(0, Math.floor(wx));
    const x1 = Math.min(width - 1, x0 + 1);
    const a = values[x0] ?? height;
    const b = values[x1] ?? height;
    return Math.abs(b - a) > CLIFF
      ? (values[Math.floor(u / ART_SCALE)] ?? height)
      : a + (b - a) * (wx - x0);
  };

  for (let u = 0; u < artWidth; u++) {
    const x = Math.floor(u / ART_SCALE);
    const colTop = top[x] ?? height;
    const surfTop = surfaceAt(top, u);
    const baseline = surfaceAt(base, u);
    const slope = (smooth(Math.min(width - 1, x + 6)) - smooth(Math.max(0, x - 6))) / 12;
    const stretch = Math.min(T.mossBandMaxStretch, Math.sqrt(1 + slope * slope));
    const highlightEnd = HIGHLIGHT.to * stretch;
    const mainEnd = MAIN.to * stretch;
    const underEnd = UNDER.to * stretch;
    const variation = mossVariation(x);
    const bump = owner[x] ?? -1;
    const bumpJitter = 1 + (hash2(bump, 31) * 2 - 1) * T.mossFuzz.colorJitter;

    for (let v = colTop * ART_SCALE; v < height * ART_SCALE; v++) {
      const y = Math.floor(v / ART_SCALE);
      if (data[y * width + x] === 0) continue;
      const wy = (v + 0.5) / ART_SCALE - OUTLINE;
      const fromTop = wy - surfTop;
      const fromBase = wy - baseline;
      const o = (v * artWidth + u) * 4;
      if (fromTop < highlightEnd) {
        put(out, o, varyMoss(HIGHLIGHT.rgb, variation)); // crisp: no grain
      } else if (fromBase < 0) {
        put(out, o, varyMoss(FUZZ_RGB, variation), bumpJitter);
      } else if (fromBase < mainEnd - HIGHLIGHT.to) {
        put(out, o, varyMoss(MAIN.rgb, variation), 0.97 + hash2(u, v) * 0.06);
      } else if (fromBase < underEnd - HIGHLIGHT.to) {
        put(out, o, UNDER.rgb); // crisp shadow line between moss and soil
      } else {
        const t = soilTexel(tile, u, v);
        const depth = Math.max(0, fromBase);
        const k =
          (1 - soilShadeRange * Math.min(1, depth / DARKEST_DEPTH)) *
          (1 - grainAmount + hash2(u, v) * 2 * grainAmount);
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

function clamp01(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

export interface TerrainSources {
  /** Art-sized base colors. */
  readonly base: Rgba;
  /** World-sized scorch, 0..255. */
  readonly burn: Uint8Array;
  readonly field: EdgeField;
  /**
   * True when the base art already has the contour along the original silhouette (drawn maps):
   * the engine then adds it only on fresh cuts.
   */
  readonly drawnOutline: boolean;
}

/**
 * Writes the visible terrain for `art` (a rect in art px) into `target`, an RGBA buffer of
 * exactly that rect's size.
 *
 * Coverage, contour and lip come from the edge field, bilinearly interpolated between world
 * pixel centers, so edges are smooth at art resolution yet sit on the mask's edge (sd = 0).
 */
export function composeTerrain(target: Rgba, src: TerrainSources, art: PixelRect): void {
  const { base, burn, field, drawnOutline } = src;
  const { width, height, sd, fresh } = field;
  const artWidth = width * ART_SCALE;
  const lipK = T.freshCut.lighten - 1;
  const burnK = T.burnOpacity / 255;

  // Bilinear taps per art column: world pixel centers at x0 and x0 + 1, weight of x0 + 1.
  const tapX0 = new Int32Array(art.width);
  const tapX1 = new Int32Array(art.width);
  const tapWX = new Float32Array(art.width);
  for (let c = 0; c < art.width; c++) {
    const fx = (art.x + c + 0.5) / ART_SCALE - 0.5;
    const x0 = Math.floor(fx);
    tapX0[c] = Math.max(0, x0);
    tapX1[c] = Math.min(width - 1, x0 + 1);
    tapWX[c] = fx - x0;
  }

  for (let r = 0; r < art.height; r++) {
    const v = art.y + r;
    const fy = (v + 0.5) / ART_SCALE - 0.5;
    const y0 = Math.floor(fy);
    const row0 = Math.max(0, y0) * width;
    const row1 = Math.min(height - 1, y0 + 1) * width;
    const wy = fy - y0;
    const nearRow = Math.min(height - 1, Math.floor((v + 0.5) / ART_SCALE)) * width;

    for (let c = 0; c < art.width; c++) {
      const o = (r * art.width + c) * 4;
      const a = tapX0[c] ?? 0;
      const b = tapX1[c] ?? 0;
      const wx = tapWX[c] ?? 0;
      const lerp = (buf: ArrayLike<number>): number => {
        const top = (buf[row0 + a] ?? 0) + ((buf[row0 + b] ?? 0) - (buf[row0 + a] ?? 0)) * wx;
        const bot = (buf[row1 + a] ?? 0) + ((buf[row1 + b] ?? 0) - (buf[row1 + a] ?? 0)) * wx;
        return top + (bot - top) * wy;
      };

      const d = lerp(sd);
      // Coverage of this art pixel (its width is 1 / ART_SCALE world px).
      const alpha = clamp01(d * ART_SCALE + 0.5);
      if (alpha === 0) {
        target[o + 3] = 0;
        continue;
      }

      const u = art.x + c;
      const bo = (v * artWidth + u) * 4;
      let red = base[bo] ?? 0;
      let green = base[bo + 1] ?? 0;
      let blue = base[bo + 2] ?? 0;

      const isFresh = fresh[nearRow + Math.floor((u + 0.5) / ART_SCALE)] === 1;
      if (isFresh) {
        const lip = lipK * clamp01((OUTLINE + LIP - d) * ART_SCALE + 0.5);
        red *= 1 + lip;
        green *= 1 + lip;
        blue *= 1 + lip;
      }

      const k = lerp(burn) * burnK;
      if (k > 0) {
        red += (BURN_RGB[0] - red) * k;
        green += (BURN_RGB[1] - green) * k;
        blue += (BURN_RGB[2] - blue) * k;
      }

      if (isFresh || !drawnOutline) {
        const t = clamp01((OUTLINE - d) * ART_SCALE + 0.5);
        red += (OUTLINE_RGB[0] - red) * t;
        green += (OUTLINE_RGB[1] - green) * t;
        blue += (OUTLINE_RGB[2] - blue) * t;
      }

      target[o] = red;
      target[o + 1] = green;
      target[o + 2] = blue;
      target[o + 3] = Math.round(255 * alpha);
    }
  }
}
