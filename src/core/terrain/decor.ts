/**
 * Surface decor that is part of the terrain mask, so shots hit it and snails can stand on it
 * ("logic = picture"). The renderer paints its colors over exactly these pixels.
 */

import type { TerrainMask } from './mask';

export interface Mushroom {
  readonly kind: 'mushroom';
  /** Bottom center of the stem, in world pixels. */
  readonly x: number;
  readonly y: number;
  /** 1 = the size of public/art/mushroom.svg. */
  readonly scale: number;
}

export interface DewDrop {
  readonly kind: 'dew';
  /** Center of the drop. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface GrassBlade {
  /** Offset of the blade base from the tuft x. */
  readonly dx: number;
  /** Y of the blade base (its lowest pixel, sunk into the ground). */
  readonly y: number;
  readonly height: number;
  /** Horizontal shift of the tip relative to the base. */
  readonly lean: number;
}

export interface GrassTuft {
  readonly kind: 'grass';
  readonly x: number;
  readonly blades: readonly GrassBlade[];
}

export type Decor = Mushroom | DewDrop | GrassTuft;

/** Mushroom silhouette at scale 1 (matches public/art/mushroom.svg), relative to the stem bottom. */
export const MUSHROOM = {
  stemHalfWidth: 3,
  stemHeight: 14,
  capCenterY: -12,
  capRadiusX: 12,
  capRadiusY: 9,
} as const;

export type MushroomPart = 'stem' | 'cap' | null;

/** Which part of a mushroom covers pixel offset (dx, dy) from the stem bottom, by pixel center. */
export function mushroomPartAt(dx: number, dy: number, scale = 1): MushroomPart {
  const x = (dx + 0.5) / scale;
  const y = (dy + 0.5) / scale;
  const { stemHalfWidth, stemHeight, capCenterY, capRadiusX, capRadiusY } = MUSHROOM;
  if (y <= capCenterY) {
    const nx = x / capRadiusX;
    const ny = (y - capCenterY) / capRadiusY;
    if (nx * nx + ny * ny <= 1) return 'cap';
  }
  if (x >= -stemHalfWidth && x <= stemHalfWidth && y >= -stemHeight && y <= 0) return 'stem';
  return null;
}

export interface DecorBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Absolute pixel bounds (inclusive) of a decor item. */
export function decorBounds(d: Decor): DecorBounds {
  switch (d.kind) {
    case 'mushroom': {
      const rx = Math.ceil(MUSHROOM.capRadiusX * d.scale);
      return {
        left: d.x - rx,
        right: d.x + rx,
        top: d.y + Math.floor((MUSHROOM.capCenterY - MUSHROOM.capRadiusY) * d.scale),
        bottom: d.y,
      };
    }
    case 'dew': {
      const r = Math.ceil(d.r);
      return {
        left: Math.floor(d.x) - r,
        right: Math.floor(d.x) + r,
        top: Math.floor(d.y) - r,
        bottom: Math.floor(d.y) + r,
      };
    }
    case 'grass': {
      let left = d.x;
      let right = d.x;
      let top = Infinity;
      let bottom = -Infinity;
      for (const b of d.blades) {
        left = Math.min(left, d.x + b.dx + Math.min(0, b.lean));
        right = Math.max(right, d.x + b.dx + Math.max(0, b.lean));
        top = Math.min(top, b.y - b.height + 1);
        bottom = Math.max(bottom, b.y);
      }
      return { left, right, top, bottom };
    }
  }
}

function bladeX(d: GrassTuft, b: GrassBlade, py: number): number {
  const k = b.y - py; // 0 at the base
  return d.x + b.dx + Math.floor((b.lean * k) / b.height + 0.5);
}

/** True if decor `d` covers world pixel (px, py). */
export function decorCovers(d: Decor, px: number, py: number): boolean {
  switch (d.kind) {
    case 'mushroom':
      return mushroomPartAt(px - d.x, py - d.y, d.scale) !== null;
    case 'dew': {
      const dx = px + 0.5 - d.x;
      const dy = py + 0.5 - d.y;
      return dx * dx + dy * dy <= d.r * d.r;
    }
    case 'grass':
      return d.blades.some((b) => py <= b.y && py > b.y - b.height && px === bladeX(d, b, py));
  }
}

/**
 * Stamps decor into the mask. Returns the indices of the pixels it turned from air into solid;
 * pixels already solid (the part sunk into the ground) stay ground and are not the decor's.
 */
export function stampDecor(mask: TerrainMask, d: Decor): Int32Array {
  const { width, height, data } = mask;
  const b = decorBounds(d);
  const added: number[] = [];
  for (let py = Math.max(0, b.top); py <= Math.min(height - 1, b.bottom); py++) {
    for (let px = Math.max(0, b.left); px <= Math.min(width - 1, b.right); px++) {
      const i = py * width + px;
      if (data[i] === 0 && decorCovers(d, px, py)) {
        data[i] = 1;
        added.push(i);
      }
    }
  }
  return Int32Array.from(added);
}

/** Ground pixels a decor item rests on; if any of them is carved away, the item falls. */
export function decorSupport(d: Decor): readonly { readonly x: number; readonly y: number }[] {
  switch (d.kind) {
    case 'mushroom':
      return [{ x: d.x, y: d.y + 1 }];
    case 'dew':
      return [{ x: Math.floor(d.x), y: Math.floor(d.y + d.r) + 1 }];
    case 'grass':
      return d.blades.map((b) => ({ x: d.x + b.dx, y: b.y + 1 }));
  }
}
