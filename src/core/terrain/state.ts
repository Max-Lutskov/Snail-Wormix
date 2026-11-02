/**
 * Serializable terrain state: where the terrain came from plus every crater, in order.
 * The pixel mask is rebuilt from this, so the JSON stays a few KB instead of ~1 MB.
 */

import { generateHills } from './hills';
import type { TerrainLayout } from './layout';
import { carveCircle, type PixelRect } from './mask';

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

/** Builds the live terrain: the source's layout with all logged craters carved. */
export function buildTerrain(state: TerrainState): TerrainLayout {
  const layout = buildBaseTerrain(state.source);
  for (const { x, y, r } of state.craters) carveCircle(layout.mask, x, y, r);
  return layout;
}

/**
 * Carves the crater into the live mask (in place) and returns the new state with the
 * crater logged, plus the pixel rect that changed (for the renderer).
 */
export function addCrater(
  state: TerrainState,
  layout: TerrainLayout,
  crater: Crater,
): { state: TerrainState; changed: PixelRect | null } {
  const changed = carveCircle(layout.mask, crater.x, crater.y, crater.r);
  return { state: { ...state, craters: [...state.craters, crater] }, changed };
}
