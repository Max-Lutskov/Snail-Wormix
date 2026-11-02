/**
 * Pixel art for the terrain, following docs/art/ART_SPEC.md ("Сад і город").
 *
 * Three buffers, all world-sized:
 * - base: the untouched look (soil tile, moss, decor), painted once from the pre-crater terrain;
 * - burn: 0..255 scorch intensity around craters, accumulated with max();
 * - the visible texture = base blended toward the burn color, a back wall where ground was
 *   blown out, transparent elsewhere.
 */

import {
  decorBounds,
  decorCovers,
  mushroomPartAt,
  type Decor,
  type DewDrop,
  type Mushroom,
} from '../../core/terrain/decor';
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
const OUTLINE_RGB = hexToRgb(C.snail.outline);
const STEM_RGB = hexToRgb(C.mushroom.stem);
const STEM_SHADE_RGB: Rgb = [STEM_RGB[0] * 0.8, STEM_RGB[1] * 0.78, STEM_RGB[2] * 0.75];
const CAP_RGB = hexToRgb(C.mushroom.cap);
const CAP_DOT_RGB = hexToRgb(C.mushroom.dots);
const DEW_RGB = hexToRgb(C.dew.fill);
const DEW_OUTLINE_RGB = hexToRgb(C.dew.outline);
const DEW_SHINE_RGB = hexToRgb(C.dew.highlight);
const GRASS_RGB = hexToRgb(C.grass);
/** Depth (px below the surface) at which soil reaches its darkest shade. */
const DARKEST_DEPTH = 420;
/** White dots on the mushroom cap at scale 1, relative to the stem bottom (from mushroom.svg). */
const CAP_DOTS = [
  { x: -5, y: -18, r: 2 },
  { x: 4, y: -20, r: 2.4 },
] as const;
/** Half-width of the window used to smooth the surface before measuring its slope. */
const SLOPE_SMOOTH = 12;
/**
 * Decor pixels are stored with this alpha in the base art (visually opaque): when blown out
 * they become sky, not back wall, because they stuck out of the ground.
 */
const DECOR_ALPHA = 254;

/** Cheap stable integer hash → [0, 1) (render-only). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function put(out: Rgba, o: number, rgb: Rgb, k = 1, alpha = 255): void {
  out[o] = rgb[0] * k;
  out[o + 1] = rgb[1] * k;
  out[o + 2] = rgb[2] * k;
  out[o + 3] = alpha;
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

/** Marks every pixel covered by decor. */
function decorMap(layout: TerrainLayout): Uint8Array {
  const { width, height } = layout.mask;
  const map = new Uint8Array(width * height);
  for (const d of layout.decor) {
    const b = decorBounds(d);
    for (let y = Math.max(0, b.top); y <= Math.min(height - 1, b.bottom); y++) {
      for (let x = Math.max(0, b.left); x <= Math.min(width - 1, b.right); x++) {
        if (decorCovers(d, x, y)) map[y * width + x] = 1;
      }
    }
  }
  return map;
}

/** Ground art for generated terrain: varied soil tile, moss along the surface, painted decor. */
export function paintGardenArt(layout: TerrainLayout, tile: SoilTile): Rgba {
  const { width, height, data } = layout.mask;
  const out = new Uint8ClampedArray(width * height * 4);
  const isDecor = decorMap(layout);
  const { lift, owner } = mossBumpLift(width, layout.mossBumps);

  // First ground pixel per column, ignoring decor.
  const top = new Int32Array(width).fill(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      if (data[i] === 1 && isDecor[i] === 0) {
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
      // Ground is painted under decor too: decor parts that blend in (stem foot) show it.
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

  for (const d of layout.decor) paintDecor(out, layout.mask, d);
  return out;
}

function paintDecor(out: Rgba, mask: TerrainMask, d: Decor): void {
  const { width, height, data } = mask;
  const b = decorBounds(d);
  for (let y = Math.max(0, b.top); y <= Math.min(height - 1, b.bottom); y++) {
    for (let x = Math.max(0, b.left); x <= Math.min(width - 1, b.right); x++) {
      const i = y * width + x;
      if (data[i] === 0 || !decorCovers(d, x, y)) continue;
      const rgb = decorColor(d, x, y);
      if (rgb) put(out, i * 4, rgb, 1, DECOR_ALPHA);
      // A part meant to blend into the ground, but there is no ground art under it (a gap
      // between moss bumps): fill with moss so it doesn't show as a black hole.
      else if (out[i * 4 + 3] === 0) put(out, i * 4, MAIN.rgb, 1, DECOR_ALPHA);
    }
  }
}

/** Color of a decor pixel, or null to leave the ground art underneath (e.g. stem foot). */
function decorColor(d: Decor, x: number, y: number): Rgb | null {
  switch (d.kind) {
    case 'mushroom':
      return mushroomColor(d, x, y);
    case 'dew':
      return dewColor(d, x, y);
    case 'grass':
      return GRASS_RGB;
  }
}

function mushroomColor(m: Mushroom, x: number, y: number): Rgb | null {
  const dx = x - m.x;
  const dy = y - m.y;
  const part = mushroomPartAt(dx, dy, m.scale);
  if (part === 'stem' && dy > -3 * m.scale) return null; // stem foot stays in the moss
  // Thin outline where the mushroom meets air keeps it readable against the sky.
  const edge =
    mushroomPartAt(dx - 1, dy, m.scale) === null ||
    mushroomPartAt(dx + 1, dy, m.scale) === null ||
    mushroomPartAt(dx, dy - 1, m.scale) === null;
  if (part === 'cap') {
    // Outline only the cap: the stem is too thin (4–8 px) and would read as a dark stick.
    if (edge) return OUTLINE_RGB;
    const s = m.scale;
    const dot = CAP_DOTS.some((c) => (dx - c.x * s) ** 2 + (dy - c.y * s) ** 2 <= (c.r * s) ** 2);
    return dot ? CAP_DOT_RGB : CAP_RGB;
  }
  return edge ? STEM_SHADE_RGB : STEM_RGB;
}

function dewColor(d: DewDrop, x: number, y: number): Rgb {
  const covered = (px: number, py: number): boolean => decorCovers(d, px, py);
  if (!covered(x - 1, y) || !covered(x + 1, y) || !covered(x, y - 1) || !covered(x, y + 1)) {
    return DEW_OUTLINE_RGB;
  }
  const sx = Math.floor(d.x - d.r * 0.35);
  const sy = Math.floor(d.y - d.r * 0.35);
  if ((x === sx || x === sx + 1) && y === sy) return DEW_SHINE_RGB;
  return DEW_RGB;
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

/**
 * Back wall behind blown-out ground (not in the art spec yet, tentative): mostly a flat cool
 * grey-brown with a faint trace of the soil texture, lighter than the burnt rim so the rim
 * stays the darkest line between solid ground and the hole.
 */
const BACK_WALL_TEXTURE = 0.3;
const BACK_WALL_RGB: Rgb = [46 * 0.7, 38 * 0.7, 36 * 0.7];

/**
 * Writes the visible terrain for `rect` into `target`. `base` is painted from the terrain
 * before any crater: alpha 255 marks where ground used to be, DECOR_ALPHA marks decor.
 */
export function composeTerrain(
  target: Rgba,
  base: Rgba,
  burn: Uint8Array,
  mask: TerrainMask,
  rect: PixelRect,
): void {
  const { width } = mask;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = y * width + x;
      const o = i * 4;
      if (mask.data[i] === 0) {
        if (base[o + 3] === 255) {
          // Blown-out ground shows a flat, muted back wall instead of the sky.
          target[o] = (base[o] ?? 0) * BACK_WALL_TEXTURE + BACK_WALL_RGB[0];
          target[o + 1] = (base[o + 1] ?? 0) * BACK_WALL_TEXTURE + BACK_WALL_RGB[1];
          target[o + 2] = (base[o + 2] ?? 0) * BACK_WALL_TEXTURE + BACK_WALL_RGB[2];
          target[o + 3] = 255;
        } else {
          target[o + 3] = 0;
        }
        continue;
      }
      const k = (burn[i] ?? 0) / 255;
      target[o] = (base[o] ?? 0) + (BURN_RGB[0] - (base[o] ?? 0)) * k;
      target[o + 1] = (base[o + 1] ?? 0) + (BURN_RGB[1] - (base[o + 1] ?? 0)) * k;
      target[o + 2] = (base[o + 2] ?? 0) + (BURN_RGB[2] - (base[o + 2] ?? 0)) * k;
      target[o + 3] = 255;
    }
  }
}
