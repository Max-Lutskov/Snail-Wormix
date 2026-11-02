/**
 * Pixel art for the terrain, following docs/art/ART_SPEC.md ("Сад і город").
 *
 * Three buffers, all world-sized:
 * - base: the untouched look (soil tile, moss bands, mushrooms), painted once;
 * - burn: 0..255 scorch intensity around craters, accumulated with max();
 * - the visible texture = base blended toward the burn color, transparent where the mask is air.
 */

import { MUSHROOM_BOUNDS, mushroomPartAt, type Decor } from '../../core/terrain/decor';
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
const MOSS_BANDS = T.mossBands.map((b) => ({ ...b, rgb: hexToRgb(b.color) }));
const MOSS_DEPTH = Math.max(...T.mossBands.map((b) => b.to));
const BURN_RGB = hexToRgb(C.crater.burn);
const STEM_RGB = hexToRgb('#F4EBDD');
const CAP_RGB = hexToRgb(C.crater.tomatoSplat);
const DOT_RGB: Rgb = [255, 255, 255];
const OUTLINE_RGB = hexToRgb(C.snail.outline);
/** Depth (px below the surface) at which soil reaches its darkest shade. */
const DARKEST_DEPTH = 420;
/** White dots on the mushroom cap, relative to the stem bottom (from mushroom.svg). */
const CAP_DOTS = [
  { x: -5, y: -18, r: 2 },
  { x: 4, y: -20, r: 2.4 },
] as const;

/** Cheap stable per-pixel hash in [0, 1) for subtle variation (render-only). */
function grain(x: number, y: number): number {
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

function mossAt(depth: number): Rgb | null {
  for (const band of MOSS_BANDS) if (depth >= band.from && depth < band.to) return band.rgb;
  return null;
}

/** Ground art for generated terrain: soil tile darkening with depth, moss on the surface. */
export function paintGardenArt(layout: TerrainLayout, tile: SoilTile): Rgba {
  const { width, height, data } = layout.mask;
  const out = new Uint8ClampedArray(width * height * 4);
  const shadeRange = 1 - T.depthDarkenMin;

  for (let x = 0; x < width; x++) {
    let depth = -1; // pixels since the last air pixel above
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      if (data[i] === 0) {
        depth = -1;
        continue;
      }
      depth++;
      const o = i * 4;
      const moss = depth < MOSS_DEPTH ? mossAt(depth) : null;
      if (moss) {
        put(out, o, moss, 0.94 + grain(x, y) * 0.12);
        continue;
      }
      const t = ((y % tile.size) * tile.size + (x % tile.size)) * 4;
      const shade = 1 - shadeRange * Math.min(1, depth / DARKEST_DEPTH);
      out[o] = (tile.pixels[t] ?? 0) * shade;
      out[o + 1] = (tile.pixels[t + 1] ?? 0) * shade;
      out[o + 2] = (tile.pixels[t + 2] ?? 0) * shade;
      out[o + 3] = 255;
    }
  }

  for (const d of layout.decor) paintMushroom(out, layout.mask, d);
  return out;
}

function paintMushroom(out: Rgba, mask: TerrainMask, m: Decor): void {
  const { width, height, data } = mask;
  for (let dy = MUSHROOM_BOUNDS.top; dy <= MUSHROOM_BOUNDS.bottom; dy++) {
    for (let dx = MUSHROOM_BOUNDS.left; dx <= MUSHROOM_BOUNDS.right; dx++) {
      const part = mushroomPartAt(dx, dy);
      if (part === null) continue;
      const px = m.x + dx;
      const py = m.y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = py * width + px;
      if (data[i] === 0) continue;
      // Thin outline where the mushroom meets air keeps it readable against the sky.
      const edge =
        mushroomPartAt(dx - 1, dy) === null ||
        mushroomPartAt(dx + 1, dy) === null ||
        mushroomPartAt(dx, dy - 1) === null;
      if (part === 'stem' && dy > -3) continue; // stem foot stays in the moss
      if (edge) {
        put(out, i * 4, OUTLINE_RGB);
      } else if (
        part === 'cap' &&
        CAP_DOTS.some((c) => (dx - c.x) ** 2 + (dy - c.y) ** 2 <= c.r * c.r)
      ) {
        put(out, i * 4, DOT_RGB);
      } else {
        put(out, i * 4, part === 'cap' ? CAP_RGB : STEM_RGB, 0.95 + grain(px, py) * 0.08);
      }
    }
  }
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
      const v = Math.round(255 * Math.min(1, Math.max(0, t)) * (0.85 + grain(x, y) * 0.15));
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
 * before any crater, so its opaque pixels mark where ground used to be.
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
