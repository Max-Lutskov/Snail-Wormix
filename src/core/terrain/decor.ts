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
}

export type Decor = Mushroom;

/** Mushroom silhouette (matches public/art/mushroom.svg), relative to the stem bottom. */
export const MUSHROOM = {
  stemHalfWidth: 3,
  stemHeight: 14,
  capCenterY: -12,
  capRadiusX: 12,
  capRadiusY: 9,
} as const;

export type MushroomPart = 'stem' | 'cap' | null;

/** Which part of a mushroom covers pixel offset (dx, dy) from the stem bottom, by pixel center. */
export function mushroomPartAt(dx: number, dy: number): MushroomPart {
  const x = dx + 0.5;
  const y = dy + 0.5;
  const { stemHalfWidth, stemHeight, capCenterY, capRadiusX, capRadiusY } = MUSHROOM;
  if (y <= capCenterY) {
    const nx = x / capRadiusX;
    const ny = (y - capCenterY) / capRadiusY;
    if (nx * nx + ny * ny <= 1) return 'cap';
  }
  if (x >= -stemHalfWidth && x <= stemHalfWidth && y >= -stemHeight && y <= 0) return 'stem';
  return null;
}

/** Bounding box of the mushroom stamp relative to the stem bottom. */
export const MUSHROOM_BOUNDS = {
  left: -MUSHROOM.capRadiusX,
  right: MUSHROOM.capRadiusX,
  top: MUSHROOM.capCenterY - MUSHROOM.capRadiusY,
  bottom: 0,
} as const;

export function stampMushroom(mask: TerrainMask, m: Mushroom): void {
  const { width, height, data } = mask;
  for (let dy = MUSHROOM_BOUNDS.top; dy <= MUSHROOM_BOUNDS.bottom; dy++) {
    for (let dx = MUSHROOM_BOUNDS.left; dx <= MUSHROOM_BOUNDS.right; dx++) {
      if (mushroomPartAt(dx, dy) === null) continue;
      const px = m.x + dx;
      const py = m.y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      data[py * width + px] = 1;
    }
  }
}
