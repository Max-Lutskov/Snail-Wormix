/**
 * Serializable terrain state: where the terrain came from plus every crater, in order.
 * The pixel mask is rebuilt from this, so the JSON stays a few KB instead of ~1 MB.
 */

import { decorSupport } from './decor';
import { generateHills } from './hills';
import type { TerrainLayout } from './layout';
import { carveCircle, isSolid, type PixelRect } from './mask';

// Drawn maps ({ kind: 'map'; id }) are added together with the PNG loader.
export type TerrainSource = { readonly kind: 'hills'; readonly seed: number };

export interface Crater {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface TerrainState {
  readonly source: TerrainSource;
  readonly craters: readonly Crater[];
}

export function createTerrainState(source: TerrainSource): TerrainState {
  return { source, craters: [] };
}

/** The terrain exactly as its source produces it, before any crater. */
export function buildBaseTerrain(source: TerrainSource): TerrainLayout {
  return generateHills(source.seed);
}

/** Builds the live terrain: the source's layout with all logged craters applied. */
export function buildTerrain(state: TerrainState): TerrainLayout {
  const layout = buildBaseTerrain(state.source);
  for (const crater of state.craters) applyCrater(layout, crater);
  return layout;
}

/**
 * Carves the crater into the live terrain (in place) and returns the new state with the
 * crater logged, the pixel rect that changed and the decor items it destroyed.
 */
export function addCrater(
  state: TerrainState,
  layout: TerrainLayout,
  crater: Crater,
): { state: TerrainState; changed: PixelRect | null; removedDecor: number[] } {
  const { changed, removedDecor } = applyCrater(layout, crater);
  return { state: { ...state, craters: [...state.craters, crater] }, changed, removedDecor };
}

/**
 * The one place a crater changes terrain, shared by live play and replays:
 * decor it touches or undermines is destroyed (all of its pixels cleared), then the circle
 * is carved.
 */
function applyCrater(
  layout: TerrainLayout,
  crater: Crater,
): { changed: PixelRect | null; removedDecor: number[] } {
  const { mask, decor, decorPixels, decorAlive } = layout;
  const touched = decor.map((_, i) => decorAlive[i] === 1 && pixelsInCircle(layout, i, crater));
  const changed = carveCircle(mask, crater.x, crater.y, crater.r);

  const removedDecor: number[] = [];
  decor.forEach((d, i) => {
    if (decorAlive[i] !== 1) return;
    const undermined = decorSupport(d).some((p) => !isSolid(mask, p.x, p.y));
    if (!touched[i] && !undermined) return;
    decorAlive[i] = 0;
    for (const p of decorPixels[i] ?? []) mask.data[p] = 0;
    removedDecor.push(i);
  });
  return { changed, removedDecor };
}

/** True if any of the decor item's pixels has its center inside the crater (as carveCircle). */
function pixelsInCircle(layout: TerrainLayout, index: number, c: Crater): boolean {
  const { width } = layout.mask;
  const r2 = c.r * c.r;
  for (const p of layout.decorPixels[index] ?? []) {
    const dx = (p % width) + 0.5 - c.x;
    const dy = Math.floor(p / width) + 0.5 - c.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}
