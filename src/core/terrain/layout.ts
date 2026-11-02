import type { Decor } from './decor';
import type { TerrainMask } from './mask';

export interface SpawnPoint {
  /** A snail is dropped above this x and falls onto the surface. */
  readonly x: number;
}

/** Everything a terrain source (generator or drawn map) produces. */
export interface TerrainLayout {
  readonly mask: TerrainMask;
  /** Y of the water surface; anything at or below it drowns. */
  readonly waterLevel: number;
  readonly spawns: readonly SpawnPoint[];
  /** Solid surface decor (already stamped into the mask), for the renderer to paint. */
  readonly decor: readonly Decor[];
}
