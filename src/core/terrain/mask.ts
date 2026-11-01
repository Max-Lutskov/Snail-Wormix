/**
 * Pixel-precise terrain mask: one byte per world pixel, 1 = ground, 0 = air.
 *
 * The mask is a derived cache, never serialized: it is rebuilt from the terrain
 * source plus the crater log (see state.ts). All operations use only exact
 * arithmetic so every client, the server and replays get identical masks.
 */

export interface TerrainMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function createMask(width: number, height: number): TerrainMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`createMask: invalid size ${width}x${height}`);
  }
  return { width, height, data: new Uint8Array(width * height) };
}

export function cloneMask(mask: TerrainMask): TerrainMask {
  return { width: mask.width, height: mask.height, data: mask.data.slice() };
}

/** True if the pixel containing (x, y) is ground. Outside the world is air. */
export function isSolid(mask: TerrainMask, x: number, y: number): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
  return mask.data[py * mask.width + px] === 1;
}

/** Makes column x solid from surfaces[x] down to the bottom of the world. */
export function fillBelow(mask: TerrainMask, surfaces: ArrayLike<number>): void {
  const { width, height, data } = mask;
  for (let x = 0; x < width; x++) {
    const top = Math.max(0, Math.floor(surfaces[x] ?? height));
    for (let y = top; y < height; y++) data[y * width + x] = 1;
  }
}

/** Y of the first ground pixel from the top of column x, or null if the column is empty. */
export function surfaceY(mask: TerrainMask, x: number): number | null {
  const px = Math.floor(x);
  if (px < 0 || px >= mask.width) return null;
  for (let y = 0; y < mask.height; y++) {
    if (mask.data[y * mask.width + px] === 1) return y;
  }
  return null;
}

/**
 * Turns into air every pixel whose center lies within the circle.
 * Returns the bounding box of pixels that actually changed, or null if none did.
 */
export function carveCircle(
  mask: TerrainMask,
  cx: number,
  cy: number,
  r: number,
): PixelRect | null {
  if (!(r > 0)) return null;
  const { width, height, data } = mask;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.floor(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.floor(cy + r));
  const r2 = r * r;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dy2 = dy * dy;
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy2 > r2) continue;
      const i = row + x;
      if (data[i] === 0) continue;
      data[i] = 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

function fnvUint32(hash: number, value: number): number {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) h = fnvByte(h, (value >>> shift) & 0xff);
  return h;
}

/** FNV-1a hash of dimensions and pixels, for determinism tests and desync checks. */
export function checksum(mask: TerrainMask): number {
  let h = fnvUint32(FNV_OFFSET, mask.width);
  h = fnvUint32(h, mask.height);
  for (const byte of mask.data) h = fnvByte(h, byte);
  return h;
}
