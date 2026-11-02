/**
 * Distance to the ground/air boundary, per world pixel. The terrain art samples it at art
 * resolution for anti-aliased edges, the cartoon contour and the light lip of fresh cuts.
 *
 * Distances are measured between pixel centers, exact (Euclidean) up to EDGE_REACH and clamped
 * beyond. Off the world's sides counts as air (cliffs at the world edge get a contour); above and
 * below the world counts as nothing. The art reads a lightly blurred copy: distances to the
 * centers of square pixels trace a staircase, and the blur rounds it into a smooth line that
 * still stays within half a pixel of the mask's edge.
 */

import type { PixelRect } from '../../core/terrain/mask';

/** World px from the boundary within which the field is exact: covers contour + fresh-cut lip. */
export const EDGE_REACH = 8;
/**
 * Grow a ground change by this much before updating: `raw` moves up to EDGE_REACH from it, the
 * blur one more, and the blur leaves the rect's outermost pixels alone.
 */
export const EDGE_UPDATE_REACH = EDGE_REACH + 2;
/** Horizontal distance meaning "nothing within reach". */
const FAR = EDGE_REACH + 1;

export interface EdgeField {
  readonly width: number;
  readonly height: number;
  /**
   * Signed distance to the boundary: > 0 in ground, < 0 in air, at most ±EDGE_REACH. A straight
   * edge gives ±0.5 on the pixels either side, so sd = 0 runs exactly along the mask's edge.
   */
  readonly raw: Float32Array;
  /** `raw` blurred with a 3×3 [1 2 1] kernel: what the art samples. */
  readonly sd: Float32Array;
  /**
   * 1 on a fresh cut, else 0: ground whose nearest air was carved by a crater, and the carved
   * air itself (the edge's anti-aliased fringe reaches into it).
   */
  readonly fresh: Uint8Array;
}

export function createEdgeField(width: number, height: number): EdgeField {
  return {
    width,
    height,
    raw: new Float32Array(width * height),
    sd: new Float32Array(width * height),
    fresh: new Uint8Array(width * height),
  };
}

/** Per-pixel flags of one row: what each pixel counts as a target for. */
const AIR = 1;
const GROUND = 2;
const CUT = 4;

/**
 * Horizontal distance (capped at FAR) from each of `cols` columns starting at `first` to the
 * nearest pixel of the row flagged `bit`. `flags[k]` describes x = flagsX + k.
 */
function rowDistances(
  out: Uint8Array,
  offset: number,
  flags: Uint8Array,
  flagsX: number,
  bit: number,
  first: number,
  cols: number,
): void {
  const n = flags.length;
  let last = -Infinity;
  for (let k = 0; k < n; k++) {
    if (((flags[k] ?? 0) & bit) !== 0) last = k;
    const col = k + flagsX - first;
    if (col >= 0 && col < cols) out[offset + col] = Math.min(FAR, k - last);
  }
  let next = Infinity;
  for (let k = n - 1; k >= 0; k--) {
    if (((flags[k] ?? 0) & bit) !== 0) next = k;
    const col = k + flagsX - first;
    if (col >= 0 && col < cols) {
      const o = offset + col;
      out[o] = Math.min(out[o] ?? FAR, next - k);
    }
  }
}

/**
 * Squared distance from column `col` of row `y` to the nearest target, from per-row horizontal
 * distances `h` for rows [y0, y1) (row y0 at index 0).
 */
function nearest2(h: Uint8Array, cols: number, col: number, y: number, y0: number, y1: number) {
  let best = FAR * FAR;
  for (let dy = 0; dy <= EDGE_REACH && dy * dy < best; dy++) {
    const up = y - dy;
    if (up >= y0) {
      const hv = h[(up - y0) * cols + col] ?? FAR;
      if (hv < FAR && dy * dy + hv * hv < best) best = dy * dy + hv * hv;
    }
    const down = y + dy;
    if (dy > 0 && down < y1) {
      const hv = h[(down - y0) * cols + col] ?? FAR;
      if (hv < FAR && dy * dy + hv * hv < best) best = dy * dy + hv * hv;
    }
  }
  return best;
}

/**
 * Recomputes the field inside `rect`: call with the changed area grown by EDGE_UPDATE_REACH.
 * The blurred `sd` is refreshed one pixel inside the rect's edges (it reads one pixel around).
 * @param ground 1 = visible ground (mask without decor), world-sized
 * @param original the same before any crater: ground there but air in `ground` was carved
 */
export function updateEdgeField(
  field: EdgeField,
  ground: Uint8Array,
  original: Uint8Array,
  rect: PixelRect,
): void {
  const { width, height, raw, fresh } = field;
  if (rect.width <= 0 || rect.height <= 0) return;
  const y0 = Math.max(0, rect.y - EDGE_REACH);
  const y1 = Math.min(height, rect.y + rect.height + EDGE_REACH);
  const cols = rect.width;
  const toAir = new Uint8Array(cols * (y1 - y0));
  const toGround = new Uint8Array(cols * (y1 - y0));
  const toCut = new Uint8Array(cols * (y1 - y0)).fill(FAR);
  // Flags for x in [flagsX, flagsX + span): the rect plus FAR each side, one step past the world.
  const flagsX = Math.max(-1, rect.x - FAR);
  const flags = new Uint8Array(Math.min(width, rect.x + rect.width + FAR - 1) - flagsX + 1);
  let anyCut = false;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    let rowCut = false;
    for (let k = 0; k < flags.length; k++) {
      const x = flagsX + k;
      if (x < 0 || x >= width) {
        flags[k] = AIR;
        continue;
      }
      const g = ground[row + x] === 1;
      const cut = !g && original[row + x] === 1;
      if (cut) rowCut = true;
      flags[k] = (g ? GROUND : AIR) | (cut ? CUT : 0);
    }
    const offset = (y - y0) * cols;
    rowDistances(toAir, offset, flags, flagsX, AIR, rect.x, cols);
    rowDistances(toGround, offset, flags, flagsX, GROUND, rect.x, cols);
    if (!rowCut) continue;
    anyCut = true;
    rowDistances(toCut, offset, flags, flagsX, CUT, rect.x, cols);
  }

  // Per column, how many rows within ±EDGE_REACH of y have any air / ground in horizontal
  // reach. Zero means the pixel is deep inside its kind: skip the search (most of the map).
  const airRows = new Int32Array(cols);
  const groundRows = new Int32Array(cols);
  const count = (y: number, k: number): void => {
    if (y < y0 || y >= y1) return;
    const offset = (y - y0) * cols;
    for (let col = 0; col < cols; col++) {
      if ((toAir[offset + col] ?? FAR) < FAR) airRows[col] = (airRows[col] ?? 0) + k;
      if ((toGround[offset + col] ?? FAR) < FAR) groundRows[col] = (groundRows[col] ?? 0) + k;
    }
  };
  for (let y = y0; y < rect.y + EDGE_REACH; y++) count(y, 1);

  for (let y = rect.y; y < rect.y + rect.height; y++) {
    count(y + EDGE_REACH, 1);
    count(y - EDGE_REACH - 1, -1);
    for (let col = 0; col < cols; col++) {
      const i = y * width + rect.x + col;
      const isGround = ground[i] === 1;
      if ((isGround ? airRows[col] : groundRows[col]) === 0) {
        raw[i] = isGround ? EDGE_REACH : -EDGE_REACH;
        fresh[i] = !isGround && original[i] === 1 ? 1 : 0;
        continue;
      }
      const d2 = nearest2(isGround ? toAir : toGround, cols, col, y, y0, y1);
      const d = Math.min(EDGE_REACH, Math.sqrt(d2) - 0.5);
      raw[i] = isGround ? d : -d;
      if (!isGround) fresh[i] = original[i] === 1 ? 1 : 0;
      else
        fresh[i] = anyCut && d2 < FAR * FAR && nearest2(toCut, cols, col, y, y0, y1) <= d2 ? 1 : 0;
    }
  }
  blur(field, rect);
}

/** Refreshes `sd` from `raw` inside `rect`, inset by one pixel except along the world's edges. */
function blur(field: EdgeField, rect: PixelRect): void {
  const { width, height, raw, sd } = field;
  const x0 = rect.x > 0 ? rect.x + 1 : 0;
  const y0 = rect.y > 0 ? rect.y + 1 : 0;
  const x1 = rect.x + rect.width < width ? rect.x + rect.width - 1 : width;
  const y1 = rect.y + rect.height < height ? rect.y + rect.height - 1 : height;
  const at = (x: number, y: number): number =>
    raw[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] ?? 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = raw[y * width + x] ?? 0;
      sd[y * width + x] =
        (at(x - 1, y - 1) +
          2 * at(x, y - 1) +
          at(x + 1, y - 1) +
          2 * at(x - 1, y) +
          4 * v +
          2 * at(x + 1, y) +
          at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1)) /
        16;
    }
  }
}
